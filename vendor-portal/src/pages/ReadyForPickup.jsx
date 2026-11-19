import StatusJobsPage from "../components/StatusJobsPage";

// work the vendor marked ready, waiting for Star Offset to collect it
export default function ReadyForPickup() {
  return (
    <StatusJobsPage
      title="Ready for Pickup" subtitle="Work marked as ready by you and pending pickup by Star Offset Printing."
      status="ready" dateHead="Ready Date" dateOf={(r) => r.ready_at || r.updated_at} chipLabel="Ready for Pickup"
      empty="Nothing is waiting for pickup right now."
    />
  );
}
