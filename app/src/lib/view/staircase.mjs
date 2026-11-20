// Chart data for a route: the ship's msrp after each step. Pure.
import { shipName } from '../../../../src/logic/ships.mjs';
import { usd } from '../../../../src/logic/format.mjs';

/**
 * @returns {{ points: {x:number,y:number|null,ship:string,image:string|null}[] (image: local small file name), segments: {from:number,to:number,kind:string}[], empty: boolean }}
 *   x = 0 is the base ship; segment i joins points i and i+1.
 */
export function staircase(route, ships) {
  if (!route?.steps?.length) return { points: [], segments: [], empty: true };
  const point = (x, id) => ({ x, y: ships.get(id)?.msrp ?? null, ship: shipName(ships, id), image: ships.get(id)?.image?.s ?? null });
  const points = [point(0, route.steps[0].from)];
  const segments = [];
  route.steps.forEach((s, i) => {
    points.push(point(i + 1, s.to));
    segments.push({ from: i, to: i + 1, kind: s.kind });
  });
  return { points, segments, empty: false };
}

/** One line series per kind; a null entry breaks the line where same-kind segments are not adjacent. */
export function chartSeries(stair) {
  const out = {};
  for (const seg of stair.segments) {
    const data = (out[seg.kind] ??= []);
    const last = data.at(-1);
    if (last && last[0] !== seg.from) data.push([seg.from, null]);
    if (!last || last[0] !== seg.from) data.push([seg.from, stair.points[seg.from].y]);
    data.push([seg.to, stair.points[seg.to].y]);
  }
  return out;
}

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Tooltip text for an axis tooltip: the point at the hovered series data, not at the raw axis value. imageSrc turns a local file name into a loadable src. */
export function tooltipText(stair, items, imageSrc = () => null) {
  const hit = (items ?? []).find((i) => Array.isArray(i?.data) && i.data[1] != null);
  const p = hit ? stair.points[Math.round(hit.data[0])] : null;
  if (!p) return '';
  const src = p.image ? imageSrc(p.image) : null;
  const img = src ? `<img src="${esc(src)}" alt="" width="64" height="32" style="display:block;width:64px;height:32px;object-fit:cover;border-radius:3px;margin-bottom:4px"/>` : '';
  return `${img}${esc(p.ship)}<br/>${esc(usd(p.y))}`;
}
