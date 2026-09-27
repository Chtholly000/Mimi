import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import "./select.css";

type MenuStyle = CSSProperties & { "--select-hover": string };

interface SelectProps {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}

/** One app-styled picker for Settings, the subtitle controls, and the tray. */
export function Select({ label, value, options, disabled = false, onChange }: SelectProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", at: 0 });
  const [popup, setPopup] = useState<MenuStyle | null>(null);
  const [active, setActive] = useState(0);
  const selected = options.findIndex((option) => option.value === value);
  const open = popup !== null && !disabled;

  function show() {
    const button = trigger.current;
    if (!button || disabled || options.length === 0) return;
    button.focus();
    const rect = button.getBoundingClientRect();
    const theme = getComputedStyle(button);
    const width = Math.min(Math.max(rect.width, 200), window.innerWidth - 16);
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const desired = Math.min(options.length * 38 + 10, 280);
    const upwards = below < desired && above > below;
    const height = Math.min(desired, Math.max(40, upwards ? above : below));
    setPopup({
      position: "fixed",
      width,
      maxHeight: height,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      ...(upwards ? { bottom: window.innerHeight - rect.top + 5 } : { top: rect.bottom + 5 }),
      color: theme.color,
      background: theme.getPropertyValue("--select-menu-bg"),
      borderColor: theme.getPropertyValue("--select-menu-border"),
      fontFamily: theme.fontFamily,
      "--select-hover": theme.getPropertyValue("--select-hover"),
    });
    setActive(Math.max(0, selected));
    search.current = { text: "", at: 0 };
  }

  function choose(index: number) {
    const option = options[index];
    setPopup(null);
    trigger.current?.focus();
    if (option && option.value !== value) onChange(option.value);
  }

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const node = event.target as Node;
      if (!trigger.current?.contains(node) && !menu.current?.contains(node)) setPopup(null);
    };
    const dismiss = () => setPopup(null);
    const scroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) dismiss();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [open]);

  useEffect(() => {
    if (open) menu.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Tab" || event.key === "Escape") {
      if (open && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
      setPopup(null);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      if (!open) { show(); return; }
      if (event.key === "Enter" || event.key === " ") choose(active);
      else if (event.key === "Home") setActive(0);
      else if (event.key === "End") setActive(options.length - 1);
      else setActive((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
      return;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (!open) show();
      const now = Date.now();
      const text = (now - search.current.at < 700 ? search.current.text : "") + event.key.toLocaleLowerCase();
      search.current = { text, at: now };
      const index = options.findIndex((option) => option.label.toLocaleLowerCase().startsWith(text));
      if (index >= 0) setActive(index);
    }
  }

  return (
    <span className="mimi-select">
      <button ref={trigger} type="button" className="mimi-select__trigger" role="combobox"
        aria-label={label} aria-haspopup="listbox" aria-expanded={open}
        aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled || options.length === 0} onKeyDown={onKeyDown}
        onClick={() => open ? setPopup(null) : show()}>
        <span>{options[selected]?.label ?? value}</span><Icon name="chevron-down" />
      </button>
      {open && createPortal(
        <div ref={menu} id={id} className="mimi-select__menu" role="listbox" aria-label={label} style={popup}>
          {options.map((option, index) => (
            <div key={option.value} id={`${id}-${index}`} className="mimi-select__option" role="option"
              aria-selected={option.value === value} data-active={index === active}
              onPointerMove={() => setActive(index)} onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}>
              <span>{option.label}</span>{option.value === value && <Icon name="checkmark" />}
            </div>
          ))}
        </div>, document.body,
      )}
    </span>
  );
}
