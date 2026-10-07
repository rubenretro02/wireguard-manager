"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Plus, Send, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

export interface CustomerOption {
  id: string;
  telegram_id: number | null;
  /** The panel's own label (v36); Telegram's first/last are separate */
  name?: string | null;
  username: string | null;
  first_name: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  customer_type?: string;
}

export function customerLabel(c: CustomerOption): string {
  if (c.name) return c.name;
  if (c.username) return `@${c.username}`;
  const full = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return full || c.email || (c.telegram_id ? String(c.telegram_id) : "Customer");
}

interface Props {
  customers: CustomerOption[];
  value: string;
  onChange: (id: string) => void;
  onCreateNew?: () => void;
  allowNone?: boolean;
  placeholder?: string;
  /** Renders "<label>  [Telegram N] [Manual N]" above the field; the chips filter the list */
  label?: string;
}

export const byCustomerName = (a: CustomerOption, b: CustomerOption) =>
  customerLabel(a).replace(/^@/, "").localeCompare(customerLabel(b).replace(/^@/, ""), undefined, { sensitivity: "base" });

/** Searchable customer picker: type a name, @username, email, phone or Telegram id. */
export function CustomerCombobox({ customers, value, onChange, onCreateNew, allowNone, placeholder, label }: Props) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"all" | "telegram" | "manual">("all");
  const selected = customers.find((c) => c.id === value);

  const counts = {
    telegram: customers.filter((c) => c.telegram_id).length,
    manual: customers.filter((c) => !c.telegram_id).length,
  };
  // One alphabetical list; the chips narrow it down
  const items = customers
    .filter((c) => kind === "all" || (kind === "telegram" ? Boolean(c.telegram_id) : !c.telegram_id))
    .sort(byCustomerName);

  const renderItem = (c: CustomerOption) => {
    // Everything searchable goes into `value`; cmdk filters on it
    const haystack = [customerLabel(c), c.name, c.first_name, c.last_name, c.username, c.email, c.phone, c.telegram_id, c.customer_type]
      .filter(Boolean)
      .join(" ");
    return (
      <CommandItem
        key={c.id}
        value={`${haystack} ${c.id}`}
        onSelect={() => { onChange(c.id); setOpen(false); }}
        className="cursor-pointer"
      >
        <Check className={`mr-2 h-4 w-4 shrink-0 ${value === c.id ? "opacity-100" : "opacity-0"}`} />
        {c.telegram_id ? <Send className="w-3.5 h-3.5 text-sky-400 shrink-0 mr-2" /> : <UserRound className="w-3.5 h-3.5 text-violet-400 shrink-0 mr-2" />}
        <span className="truncate">{customerLabel(c)}</span>
        <span className="ml-auto pl-3 text-xs text-muted-foreground shrink-0">
          {c.email || c.phone || (c.telegram_id ? c.telegram_id : "")}
          {c.customer_type === "agent" ? " · agent" : ""}
        </span>
      </CommandItem>
    );
  };

  return (
    <div className="space-y-1.5">
    {label && (
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{label}</span>
        {([["telegram", "Telegram", counts.telegram], ["manual", "Manual", counts.manual]] as const).map(([k, text, n]) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(kind === k ? "all" : k)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
              kind === k ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {k === "telegram" ? <Send className="w-3 h-3" /> : <UserRound className="w-3 h-3" />}
            {text} <span className="opacity-70">{n}</span>
          </button>
        ))}
      </div>
    )}
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between bg-secondary border-border font-normal">
          <span className="flex items-center gap-2 truncate">
            {selected ? (
              <>
                {selected.telegram_id ? <Send className="w-3.5 h-3.5 text-sky-400 shrink-0" /> : <UserRound className="w-3.5 h-3.5 text-violet-400 shrink-0" />}
                <span className="truncate">{customerLabel(selected)}</span>
                {selected.customer_type === "agent" && <span className="text-xs text-amber-400">agent</span>}
              </>
            ) : (
              <span className="text-muted-foreground">{placeholder || (customers.length ? "Search a customer…" : "Loading customers…")}</span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0 z-[9999]"
        align="start"
        side="bottom"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onWheel={(e) => e.stopPropagation()}
        style={{ pointerEvents: "auto" }}
      >
        <Command className="border-0">
          <CommandInput placeholder="Name, @username, email, phone, Telegram id…" autoFocus />
          <CommandList
            className="max-h-[260px] overflow-y-auto"
            onWheel={(e) => { e.stopPropagation(); e.currentTarget.scrollTop += e.deltaY; }}
          >
            <CommandEmpty>
              <div className="py-2 text-sm text-muted-foreground">No customer matches.</div>
            </CommandEmpty>
            {(onCreateNew || allowNone) && (
              <CommandGroup>
                {allowNone && (
                  <CommandItem value="__none__ no customer" onSelect={() => { onChange(""); setOpen(false); }} className="cursor-pointer text-muted-foreground">
                    <Check className={`mr-2 h-4 w-4 ${!value ? "opacity-100" : "opacity-0"}`} />
                    No customer
                  </CommandItem>
                )}
                {onCreateNew && (
                  <CommandItem value="__new__ new customer create" onSelect={() => { setOpen(false); onCreateNew(); }} className="cursor-pointer text-primary">
                    <Plus className="mr-2 h-4 w-4" />
                    New customer (no Telegram)
                  </CommandItem>
                )}
              </CommandGroup>
            )}
            <CommandGroup>{items.map(renderItem)}</CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    </div>
  );
}
