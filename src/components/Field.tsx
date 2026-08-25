import type { ReactNode } from 'react';
import { UNKNOWN } from '../lib/format';

/**
 * One labelled value in the detail card.
 *
 * The whole point of this component: an unknown value is rendered as an
 * explicit, visibly-different "Unknown" rather than a blank. A blank field
 * reads as "there is nothing to say here"; Unknown reads as "nobody has
 * measured this yet", which is the truth and is also an invitation to help.
 */
export function Field({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value?: string | null;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  const unknown = children === undefined && (value === null || value === undefined || value === UNKNOWN);

  return (
    <div className="border-t border-basalt-800 py-3 first:border-t-0">
      <dt className="text-[11px] font-medium uppercase tracking-[0.12em] text-steam-400">{label}</dt>
      <dd className="mt-1 text-sm">
        {children ?? (
          <span className={unknown ? 'text-steam-400 italic' : 'text-steam-100'}>
            {unknown ? UNKNOWN : value}
          </span>
        )}
        {hint && <div className="mt-1 text-xs leading-relaxed text-steam-400">{hint}</div>}
      </dd>
    </div>
  );
}
