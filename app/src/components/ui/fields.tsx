import * as React from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

const fieldClass =
  "w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 " +
  "focus:border-white/40 focus:outline-none disabled:opacity-50"

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldClass, "h-9", className)} {...props} />
))
Input.displayName = "Input"

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(fieldClass, "min-h-[96px] resize-y leading-relaxed", className)} {...props} />
)
Textarea.displayName = "Textarea"

interface SelectProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value" | "onChange"> {
  value: string
  onChange: (value: string) => void
}

interface SelectOption {
  value: string
  label: React.ReactNode
  disabled: boolean
}

/** Keeps option children at call sites, but renders an accessible list in the app's own style. */
export const Select = React.forwardRef<HTMLButtonElement, SelectProps>(({ className, children, value, onChange, onKeyDown, onBlur, disabled, ...props }, ref) => {
  const button = React.useRef<HTMLButtonElement>(null)
  const list = React.useRef<HTMLDivElement>(null)
  const id = React.useId()
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(-1)
  const [position, setPosition] = React.useState<React.CSSProperties>({})
  const options: SelectOption[] = []
  const collect = (nodes: React.ReactNode) => React.Children.forEach(nodes, (node) => {
    if (!React.isValidElement<React.OptionHTMLAttributes<HTMLOptionElement>>(node)) return
    if (node.type === "option") options.push({ value: String(node.props.value ?? node.props.children ?? ""), label: node.props.children, disabled: Boolean(node.props.disabled) })
    else collect(node.props.children)
  })
  collect(children)
  const selected = options.findIndex((option) => option.value === value)
  const optionCount = options.length
  const firstEnabled = options.findIndex((option) => !option.disabled)
  const lastEnabled = options.reduce((last, option, index) => option.disabled ? last : index, -1)

  React.useImperativeHandle(ref, () => button.current!)
  React.useLayoutEffect(() => {
    if (!open || !button.current) return
    const place = () => {
      const rect = button.current!.getBoundingClientRect()
      const below = window.innerHeight - rect.bottom - 8
      const above = rect.top - 8
      const down = below >= Math.min(240, optionCount * 30 + 8) || below >= above
      const width = Math.min(Math.max(rect.width, 160), window.innerWidth - 16)
      setPosition({
        position: "fixed", width,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        ...(down ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 }),
        maxHeight: Math.max(40, Math.min(240, down ? below : above))
      })
    }
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!button.current?.contains(target) && !list.current?.contains(target)) setOpen(false)
    }
    place()
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    document.addEventListener("pointerdown", outside)
    return () => {
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
      document.removeEventListener("pointerdown", outside)
    }
  }, [open, optionCount])
  React.useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active, open])
  React.useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const start = (last = false) => {
    const initial = selected >= 0 && !options[selected].disabled ? selected : last ? lastEnabled : firstEnabled
    setActive(initial)
    setOpen(true)
  }
  const choose = (index: number) => {
    const option = options[index]
    if (!option || option.disabled) return
    onChange(option.value)
    setOpen(false)
    button.current?.focus()
  }
  const move = (direction: number) => {
    for (let step = 1; step <= options.length; step++) {
      const index = (active + direction * step + options.length) % options.length
      if (!options[index].disabled) { setActive(index); return }
    }
  }

  return <>
    <button
      {...props}
      ref={button}
      type="button"
      role="combobox"
      aria-label={props["aria-label"] ?? props.title}
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      aria-haspopup="listbox"
      aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
      disabled={disabled}
      className={cn(fieldClass, "inline-flex h-9 min-w-0 cursor-pointer items-center gap-2 bg-black/60 text-left", className)}
      onClick={() => open ? setOpen(false) : start()}
      onBlur={(event) => { setOpen(false); onBlur?.(event) }}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.defaultPrevented) return
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault()
          if (open) move(event.key === "ArrowDown" ? 1 : -1)
          else start(event.key === "ArrowUp")
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault()
          setOpen(true)
          setActive(event.key === "Home" ? firstEnabled : lastEnabled)
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          if (open) choose(active)
          else start()
        } else if (event.key === "Escape" && open) {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
        } else if (event.key === "Tab") setOpen(false)
      }}
    >
      <span className="min-w-0 flex-1 truncate">{options[selected]?.label ?? value}</span>
      <ChevronDown aria-hidden="true" className={cn("h-3 w-3 shrink-0 text-white/50", open && "rotate-180")} />
    </button>
    {open && createPortal(
      <div ref={list} id={id} role="listbox" aria-label={props["aria-label"] ?? props.title} style={position} className="scroll z-[100] overflow-y-auto rounded-md border border-white/20 bg-[#151e2c] p-1 text-[11.5px] text-white shadow-xl">
        {options.map((option, index) => <div
          key={option.value}
          id={`${id}-${index}`}
          role="option"
          aria-selected={option.value === value}
          aria-disabled={option.disabled || undefined}
          data-index={index}
          className={cn("flex min-h-7 cursor-pointer items-center gap-2 rounded px-2 py-1.5", index === active && "bg-white/10", option.disabled && "cursor-default opacity-40")}
          onPointerMove={() => { if (!option.disabled) setActive(index) }}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => choose(index)}
        >
          <span className="min-w-0 flex-1 break-words">{option.label}</span>
          {option.value === value && <Check aria-hidden="true" className="h-3 w-3 shrink-0 text-sky-300" />}
        </div>)}
      </div>, document.body
    )}
  </>
})
Select.displayName = "Select"

interface ToggleProps {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  label?: string
  /** "sm" fits a toolbar row (the panel); the default fits a settings row. */
  size?: "sm"
}

export function Toggle({ checked, onChange, disabled, label, size }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full border transition-colors disabled:opacity-40",
        size === "sm" ? "h-4 w-7" : "h-6 w-11",
        checked ? "border-sky-400/50 bg-sky-500/80" : "border-white/20 bg-white/10"
      )}
    >
      <span
        className={cn(
          "inline-block rounded-full bg-white shadow transition-transform",
          size === "sm" ? (checked ? "h-2.5 w-2.5 translate-x-3.5" : "h-2.5 w-2.5 translate-x-0.5") : checked ? "h-4 w-4 translate-x-6" : "h-4 w-4 translate-x-1"
        )}
      />
    </button>
  )
}

interface FieldProps {
  label: string
  hint?: string
  children: React.ReactNode
  inline?: boolean
}

/** Label + description + control, stacked or side by side. */
export function Field({ label, hint, children, inline }: FieldProps) {
  return (
    <div className={cn("rounded-lg border border-white/10 bg-white/5 p-4", inline && "flex items-center justify-between gap-4")}>
      <div className={cn(!inline && "mb-3")}>
        <div className="text-sm font-medium text-white">{label}</div>
        {hint && <p className="mt-0.5 text-xs text-white/55">{hint}</p>}
      </div>
      <div className={cn(inline && "shrink-0")}>{children}</div>
    </div>
  )
}
