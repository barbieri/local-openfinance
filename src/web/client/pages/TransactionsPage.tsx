import { TransactionsPageView } from './TransactionsPageView.js';
import { useTransactionsPageController } from './use-transactions-page-controller.js';

export function TransactionsPage() {
  const viewProps = useTransactionsPageController();
  return <TransactionsPageView {...viewProps} />;
}
