import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { fmtInput, parseLen } from '../units';

type Props = {
  label?: string;
  value: number;
  onChange: (cm: number) => void;
  min?: number;
  max?: number;
  className?: string;
};

/** Text field showing a length in the active unit; accepts "3.2m", "320", 8'6" etc. */
export function LenInput({ label, value, onChange, min = 0, max = 100000, className }: Props) {
  const unit = useStore((s) => s.unit);
  const [text, setText] = useState(fmtInput(value, unit));
  const [bad, setBad] = useState(false);
  const [focus, setFocus] = useState(false);

  useEffect(() => {
    if (!focus) { setText(fmtInput(value, unit)); setBad(false); }
  }, [value, unit, focus]);

  const commit = () => {
    const v = parseLen(text, unit);
    if (v === null || v < min || v > max) { setBad(true); return; }
    setBad(false);
    if (Math.abs(v - value) > 1e-6) onChange(v);
    setText(fmtInput(v, unit));
  };

  const body = (
    <input
      className={`field${bad ? ' bad' : ''}`}
      inputMode="decimal"
      value={text}
      onFocus={(e) => { setFocus(true); e.currentTarget.select(); }}
      onBlur={() => { setFocus(false); commit(); }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { commit(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { setText(fmtInput(value, unit)); e.currentTarget.blur(); }
        e.stopPropagation();
      }}
    />
  );
  return label ? <label className={`lbl ${className ?? ''}`}><span>{label}</span>{body}</label> : body;
}

type NumProps = { label?: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; suffix?: string };

/** Plain number field (degrees etc.). */
export function NumInput({ label, value, onChange, min = -Infinity, max = Infinity, step = 1, suffix }: NumProps) {
  const [text, setText] = useState(String(Math.round(value * 10) / 10));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(String(Math.round(value * 10) / 10)); }, [value, focus]);
  const commit = () => {
    const v = parseFloat(text.replace(',', '.'));
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
  };
  const body = (
    <div className="num">
      <input
        className="field"
        inputMode="decimal"
        step={step}
        value={text}
        onFocus={(e) => { setFocus(true); e.currentTarget.select(); }}
        onBlur={() => { setFocus(false); commit(); }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commit(); e.currentTarget.blur(); }
          e.stopPropagation();
        }}
      />
      {suffix && <em>{suffix}</em>}
    </div>
  );
  return label ? <label className="lbl"><span>{label}</span>{body}</label> : body;
}
