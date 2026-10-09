import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

// The app's own dropdown, used instead of the browser's native select so every list looks and behaves the same.
export function DeckSelect({ value, options, onChange, disabled = false }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(Math.max(0, selectedIndex));

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open]);

  function openMenu() {
    setActiveIndex(Math.max(0, selectedIndex));
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      if (!open) openMenu();
      else setActiveIndex((index) => (index + step + options.length) % options.length);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'Tab' && open) {
      setOpen(false);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(activeIndex);
      else openMenu();
    } else if (open && event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (open && event.key === 'End') {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    }
  }

  return <div className="deck-select" ref={root}>
    <button type="button" className={`select-trigger ${open ? 'open' : ''}`} role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined} disabled={disabled} onClick={() => open ? setOpen(false) : openMenu()} onKeyDown={handleKeyDown}>
      <span>{options[selectedIndex]?.label ?? value}</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {open ? <div className="select-menu" id={`${id}-options`} role="listbox" aria-label="Options">
      {options.map((option, index) => <div id={`${id}-option-${index}`} role="option" aria-selected={index === selectedIndex} key={option.value} className={`select-option ${index === activeIndex ? 'active' : ''}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(index)}>
        <span>{option.label}</span>{index === selectedIndex ? <Check size={15} aria-hidden="true" /> : null}
      </div>)}
    </div> : null}
  </div>;
}
