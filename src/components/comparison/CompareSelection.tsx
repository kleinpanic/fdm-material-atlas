/** @jsxImportSource preact */
import type { JSX } from "preact";
import type { MaterialId } from "../../data/schema/ids.ts";

type Option = Readonly<{ id: MaterialId; name: string }>;

type Props = Readonly<{
  materials: readonly Option[];
  slots: readonly string[];
  disabled: boolean;
  error: string | null;
  onChange: (index: number, value: string) => void;
  onSubmit: () => void;
}>;

const SLOT_LABELS = [
  "Material 1",
  "Material 2",
  "Material 3 (optional)",
  "Material 4 (optional)",
] as const;

export function CompareSelection({ materials, slots, disabled, error, onChange, onSubmit }: Props) {
  const selected = new Set(slots.filter(Boolean));

  return (
    <form
      aria-label="Choose materials to compare"
      aria-describedby={error === null ? undefined : "compare-selection-error"}
      onSubmit={(event: JSX.TargetedSubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div class="compare-selection__slots">
        {Array.from({ length: 4 }, (_, index) => {
          const current = slots[index] ?? "";
          const required = index < 2;
          return (
            <label class="compare-selection__slot" key={SLOT_LABELS[index]}>
              <span>{SLOT_LABELS[index]}</span>
              <select
                value={current}
                required={required}
                disabled={disabled}
                aria-invalid={error === null ? undefined : "true"}
                aria-describedby={error === null ? undefined : "compare-selection-error"}
                onChange={(event: JSX.TargetedEvent<HTMLSelectElement>) =>
                  onChange(index, event.currentTarget.value)
                }
              >
                <option value="">
                  {required ? "Choose a material" : "No additional material"}
                </option>
                {materials.map((material) => (
                  <option
                    value={material.id}
                    disabled={material.id !== current && selected.has(material.id)}
                    key={material.id}
                  >
                    {material.name}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      {error === null ? null : (
        <p id="compare-selection-error" class="compare-selection__error">
          {error}
        </p>
      )}
      <button type="submit" disabled={disabled}>
        Update comparison
      </button>
    </form>
  );
}
