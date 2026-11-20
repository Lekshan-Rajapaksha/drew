import { accents } from '../shared/model'

export function AccentPicker({ color, change }: { color: string; change: (value: string) => void }) {
  return <div className="accent-picker">
    <div className="accent-swatches" aria-label="Accent presets">
      {accents.map(value => <button key={value} type="button" title={value} aria-label={'Use ' + value}
        aria-pressed={value === color} style={{ backgroundColor: value }} onClick={() => change(value)} />)}
    </div>
    <label className="accent-input">
      <input type="color" aria-label="Custom accent color" value={color} onChange={event => change(event.target.value)} />
      <span>{color.toUpperCase()}</span>
    </label>
  </div>
}
