import { SyncReceiptForm } from './form';

export const dynamic = 'force-dynamic';
export default function SyncReceiptPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Check an original sync event</h1>
          <p>Load the saved event and check whether its original delivery was recorded.</p>
        </div>
      </div>
      <SyncReceiptForm />
    </>
  );
}
