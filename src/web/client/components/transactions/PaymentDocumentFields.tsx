import { useTranslation } from 'react-i18next';
import { formatPaymentDocumentValue, type PaymentDocument } from '../../lib/payment-document.js';

function PaymentDocumentValue({ document }: { readonly document: PaymentDocument }) {
  const formatted = formatPaymentDocumentValue(document.type, document.value);
  return (
    <span className="min-w-0 flex-1">
      {document.type.toUpperCase()}: {formatted}
    </span>
  );
}

export function PaymentDocumentFields({
  payer,
  receiver,
}: {
  readonly payer: PaymentDocument | null;
  readonly receiver: PaymentDocument | null;
}) {
  const { t } = useTranslation();

  if (!payer && !receiver) {
    return null;
  }

  return (
    <>
      {payer ? (
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-xs font-medium uppercase text-muted-foreground">
            {t('transactionDetail.payerDocument')}
          </span>
          <PaymentDocumentValue document={payer} />
        </div>
      ) : null}
      {receiver ? (
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-xs font-medium uppercase text-muted-foreground">
            {t('transactionDetail.receiverDocument')}
          </span>
          <PaymentDocumentValue document={receiver} />
        </div>
      ) : null}
    </>
  );
}
