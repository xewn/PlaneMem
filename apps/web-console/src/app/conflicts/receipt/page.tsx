import { ConflictReceiptForm } from './form';
import { ConflictLookup } from '../lookup';
export const dynamic = 'force-dynamic';
export default function ConflictReceiptPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Check an original conflict decision</h1>
          <p>Read the receipt for a saved request whose outcome needs confirmation.</p>
        </div>
      </div>
      <ConflictReceiptForm />
      <ConflictLookup />
    </>
  );
}
