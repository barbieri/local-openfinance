import { useTranslation } from 'react-i18next';
import { MdDeleteOutline } from 'react-icons/md';
import { FormattedDateTime } from '../format/dates.js';
import { Tooltip } from './Tooltip.js';

export function DeletedEntryCell({
  deletedAt,
  deleteReason,
}: {
  readonly deletedAt: string | null;
  readonly deleteReason: string | null;
}) {
  const { t } = useTranslation();
  if (!deletedAt) {
    return <>—</>;
  }

  return (
    <Tooltip
      label={t('columns.deleted')}
      content={
        <div className="space-y-1">
          <div>
            <span className="text-muted-foreground">{t('softDelete.deletedAt')}: </span>
            <FormattedDateTime value={deletedAt} />
          </div>
          {deleteReason ? (
            <div>{t('softDelete.deletedReason', { reason: deleteReason })}</div>
          ) : null}
        </div>
      }
      className="font-normal"
    >
      <MdDeleteOutline className="text-destructive" aria-hidden />
    </Tooltip>
  );
}
