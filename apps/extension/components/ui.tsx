import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:opacity-90',
  secondary: 'border border-border bg-card hover:bg-subtle',
  ghost: 'text-muted hover:bg-subtle hover:text-fg',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        buttonVariants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-lg border border-border bg-card p-3', className)}>{children}</div>;
}

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <span className="mb-1 flex items-baseline justify-between gap-2 text-xs font-medium text-muted">
      <span>{children}</span>
      {hint && <span className="font-normal">{hint}</span>}
    </span>
  );
}

const fieldClass =
  'w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm placeholder:text-muted focus:outline-2 focus:outline-accent';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(fieldClass, 'h-9', className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(fieldClass, 'min-h-16 resize-y', className)} {...props} />;
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  allowEmpty = false,
  ariaLabel,
}: {
  options: { value: T; label: ReactNode }[];
  value: T | undefined;
  onChange: (value: T | undefined) => void;
  allowEmpty?: boolean;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex rounded-md border border-border bg-subtle p-0.5">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(selected && allowEmpty ? undefined : option.value)}
            className={cx(
              'h-7 flex-1 rounded px-2 text-xs font-medium transition',
              selected ? 'bg-card text-fg shadow-sm' : 'text-muted hover:text-fg',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
      <span
        aria-hidden
        className={cx(
          'relative h-5 w-9 shrink-0 rounded-full transition',
          checked ? 'bg-accent' : 'border border-border bg-subtle',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 size-4 rounded-full bg-card shadow-sm transition-all',
            checked ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </span>
    </button>
  );
}

export function RatingInput({
  label,
  value,
  onChange,
  hint = '1 low · 5 high',
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  hint?: string;
}) {
  return (
    <label className="block">
      <Label hint={hint}>{label}</Label>
      <Segmented
        ariaLabel={label}
        allowEmpty
        value={value}
        onChange={onChange}
        options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: n }))}
      />
    </label>
  );
}

export function Note({ tone = 'muted', children }: { tone?: 'muted' | 'error'; children: ReactNode }) {
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={cx('text-xs', tone === 'error' ? 'text-bad' : 'text-muted')}>
      {children}
    </p>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">{children}</h2>
      {action}
    </div>
  );
}

export { cx };
