"""Shop wallet and Razorpay top-ups. All money movement is server-side and idempotent."""
import hashlib, hmac, json, logging, os, base64
from decimal import Decimal, InvalidOperation
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from .models import ShopWallet, ShopWalletTransaction
from .shop_portal_api import IsShopUser

logger = logging.getLogger(__name__)


def _keys():
    return os.getenv('RAZORPAY_KEY_ID', '').strip(), os.getenv('RAZORPAY_KEY_SECRET', '').strip()

def _razorpay(method, path, payload=None):
    key, secret = _keys()
    if not key or not secret:
        raise ValueError('Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the backend .env file.')
    data = json.dumps(payload).encode() if payload is not None else None
    token = base64.b64encode(f'{key}:{secret}'.encode()).decode()
    req = Request('https://api.razorpay.com/v1/' + path.lstrip('/'), data=data, method=method,
                  headers={'Authorization': 'Basic ' + token, 'Content-Type': 'application/json'})
    try:
        with urlopen(req, timeout=20) as resp: return json.loads(resp.read().decode())
    except (HTTPError, URLError, TimeoutError) as exc:
        raise ValueError('Could not connect to Razorpay. Please try again.') from exc

def _wallet(shop):
    wallet, _ = ShopWallet.objects.get_or_create(shop=shop)
    return wallet

def _credit_topup(txn_id, payment_id):
    """Add a captured Razorpay payment to the shop wallet.

    Used by BOTH the browser verify step and the Razorpay webhook, so whichever arrives first credits the
    wallet and the other finds it already completed and does nothing (a payment can never be credited twice).
    Returns True when this call did the crediting.
    """
    with transaction.atomic():
        txn = ShopWalletTransaction.objects.select_for_update().get(pk=txn_id)
        if txn.status == 'completed':
            return False
        wallet = ShopWallet.objects.select_for_update().get(pk=txn.wallet_id)
        wallet.balance += txn.amount
        wallet.save(update_fields=['balance', 'updated_at'])
        txn.status = 'completed'; txn.reference = payment_id; txn.completed_at = timezone.now()
        txn.save(update_fields=['status', 'reference', 'completed_at'])
    return True

@api_view(['GET'])
@permission_classes([IsShopUser])
def wallet_summary(request):
    wallet = _wallet(request.user.shop_profile)
    txns = ShopWalletTransaction.objects.filter(wallet=wallet).order_by('-created_at')[:50]
    return Response({'balance': str(wallet.balance), 'currency': 'INR', 'transactions': [
        {'id': t.id, 'type': t.kind, 'amount': str(t.amount), 'status': t.status, 'reference': t.reference,
         'description': t.description, 'created_at': t.created_at.isoformat()} for t in txns]})

@api_view(['POST'])
@permission_classes([IsShopUser])
def wallet_create_topup(request):
    # purpose 'order' = paying an order online from the Order Cart: the exact order total is paid through
    # Razorpay, credited to the wallet and then debited by the order, so the minimum is lower than a plain top-up.
    for_order = str(request.data.get('purpose') or '') == 'order'
    min_amount = Decimal('1.00') if for_order else Decimal('100.00')
    try:
        amount = Decimal(str(request.data.get('amount', '0')))
        if not amount.is_finite() or amount < min_amount or amount > Decimal('100000.00') or amount.quantize(Decimal('.01')) != amount:
            raise InvalidOperation
    except (InvalidOperation, TypeError, ValueError):
        return Response({'error': 'Enter an amount between ₹1 and ₹1,00,000.' if for_order else 'Enter a wallet top-up amount between ₹100 and ₹1,00,000.'}, status=400)
    wallet = _wallet(request.user.shop_profile)
    try:
        rp = _razorpay('POST', '/orders', {'amount': int(amount * 100), 'currency': 'INR', 'receipt': f'wallet-{wallet.id}-{int(timezone.now().timestamp())}', 'notes': {'shop_id': str(wallet.shop_id), 'purpose': 'shop_wallet_topup'}})
    except ValueError as e:
        return Response({'error': str(e)}, status=503)
    txn = ShopWalletTransaction.objects.create(wallet=wallet, kind='credit', amount=amount, status='pending', razorpay_order_id=rp['id'], description='Online payment for order' if for_order else 'Wallet top-up')
    key, _ = _keys()
    return Response({'transaction_id': txn.id, 'razorpay_order_id': rp['id'], 'amount': int(amount * 100), 'currency': 'INR', 'key_id': key, 'shop_name': wallet.shop.name, 'email': wallet.shop.email, 'phone': wallet.shop.phone})

@api_view(['POST'])
@permission_classes([IsShopUser])
def wallet_verify_topup(request):
    order_id = str(request.data.get('razorpay_order_id') or '')
    payment_id = str(request.data.get('razorpay_payment_id') or '')
    signature = str(request.data.get('razorpay_signature') or '')
    if not all([order_id, payment_id, signature]): return Response({'error': 'Missing Razorpay payment verification fields.'}, status=400)
    wallet = _wallet(request.user.shop_profile)
    txn = ShopWalletTransaction.objects.filter(wallet=wallet, razorpay_order_id=order_id, kind='credit').first()
    if not txn: return Response({'error': 'Wallet top-up was not found.'}, status=404)
    _, secret = _keys()
    expected = hmac.new(secret.encode(), f'{order_id}|{payment_id}'.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature): return Response({'error': 'Razorpay signature verification failed.'}, status=400)
    try: payment = _razorpay('GET', f'/payments/{payment_id}')
    except ValueError as e: return Response({'error': str(e)}, status=503)
    if payment.get('order_id') != order_id or payment.get('currency') != 'INR' or int(payment.get('amount', 0)) != int(txn.amount * 100) or payment.get('status') != 'captured':
        return Response({'error': 'Payment is not captured or does not match this top-up.'}, status=400)
    _credit_topup(txn.pk, payment_id)  # does nothing if the webhook already credited this payment
    wallet.refresh_from_db()
    return Response({'ok': True, 'balance': str(wallet.balance), 'message': 'Wallet credited successfully.'})


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def razorpay_webhook(request):
    """Razorpay -> us: "this payment was captured".  Credits the wallet even if the shop closed the browser
    before the verify step ran.  Set RAZORPAY_WEBHOOK_SECRET in .env to the secret typed in the Razorpay
    dashboard (Settings > Webhooks) and subscribe to payment.captured (order.paid is handled too).

    Always answers 200 for events it deliberately ignores, so Razorpay does not keep retrying them; it answers
    4xx for a bad signature and 5xx only when crediting failed (Razorpay then retries).
    """
    secret = os.getenv('RAZORPAY_WEBHOOK_SECRET', '').strip()
    if not secret:
        logger.error('Razorpay webhook called but RAZORPAY_WEBHOOK_SECRET is not set')
        return Response({'error': 'Webhook is not configured.'}, status=503)
    body = request.body  # the exact bytes Razorpay signed - read before anything parses them
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, request.headers.get('X-Razorpay-Signature', '')):
        return Response({'error': 'Invalid signature.'}, status=400)
    try:
        event = json.loads(body.decode())
    except ValueError:
        return Response({'error': 'Invalid payload.'}, status=400)

    if event.get('event') not in ('payment.captured', 'order.paid'):
        return Response({'ok': True, 'ignored': True})
    payment = (((event.get('payload') or {}).get('payment') or {}).get('entity')) or {}
    order_id, payment_id = str(payment.get('order_id') or ''), str(payment.get('id') or '')
    txn = ShopWalletTransaction.objects.filter(razorpay_order_id=order_id, kind='credit').first() if order_id else None
    if not txn:
        return Response({'ok': True, 'ignored': True})  # not one of our wallet payments
    try:
        matches = (payment.get('status') == 'captured' and payment.get('currency') == 'INR'
                   and int(payment.get('amount', 0)) == int(txn.amount * 100))
    except (TypeError, ValueError):
        matches = False
    if not matches:
        logger.warning('Razorpay webhook: payment %s does not match wallet transaction %s', payment_id, txn.pk)
        return Response({'ok': True, 'ignored': True})
    try:
        credited = _credit_topup(txn.pk, payment_id)
    except Exception:
        logger.exception('Razorpay webhook: could not credit wallet transaction %s', txn.pk)
        return Response({'error': 'Could not credit the wallet.'}, status=500)
    return Response({'ok': True, 'credited': credited})