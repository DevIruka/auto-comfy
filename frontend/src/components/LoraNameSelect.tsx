export function isLoraNameInvalid(
  value: string,
  names: string[],
  loading: boolean,
  listReady: boolean,
  listError: string | null,
): boolean {
  if (!value.trim() || loading) return false;
  if (listError || !listReady) return true;
  return !names.includes(value);
}

function missingReason(
  value: string,
  names: string[],
  listReady: boolean,
  listError: string | null,
): string {
  if (listError || !listReady) {
    return "Pod가 연결되지 않았거나 LoRA 목록을 불러오지 못했습니다";
  }
  if (value && !names.includes(value)) {
    return "이 Pod에 없는 LoRA입니다";
  }
  return "";
}

export function LoraNameSelect({
  names,
  value,
  onChange,
  filter,
  className,
  placeholder = "-- Select --",
  loading = false,
  listReady = false,
  listError = null,
}: {
  names: string[];
  value: string;
  onChange: (name: string) => void;
  filter: string;
  className?: string;
  placeholder?: string;
  loading?: boolean;
  listReady?: boolean;
  listError?: string | null;
}) {
  const q = filter.trim().toLowerCase();
  const filtered = q
    ? names.filter((n) => n.toLowerCase().includes(q))
    : names;
  const options =
    value && !filtered.includes(value) ? [value, ...filtered] : filtered;
  const invalid = isLoraNameInvalid(
    value,
    names,
    loading,
    listReady,
    listError,
  );
  const reason = invalid
    ? missingReason(value, names, listReady, listError)
    : "";

  return (
    <div className={`lora-select-wrap ${invalid ? "lora-select-invalid" : ""}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${className ?? ""} ${invalid ? "lora-select-error" : ""}`.trim()}
      >
        <option value="">{placeholder}</option>
        {options.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      {invalid && <div className="lora-select-error-msg">{reason}</div>}
    </div>
  );
}

export function LoraSearchInput({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (q: string) => void;
  className?: string;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="로라 이름 검색"
      className={className ?? "lora-search-input"}
    />
  );
}
