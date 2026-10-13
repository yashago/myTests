/* Renders a commit graph (lanes + labels) as HTML/SVG for the side panel. */
(function (root) {
  'use strict';

  const ROW = 30, LANE = 14, PAD = 10, LANE_COLORS = 6;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // refs: [{ name, id, kind: 'head' | 'branch' | 'remote' | 'current' }]
  function layout(commits, refs) {
    const seen = new Set();
    const stack = refs.map((r) => r.id).filter(Boolean);
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id) || !commits[id]) continue;
      seen.add(id);
      stack.push(...commits[id].parents);
    }
    const list = [...seen].map((id) => commits[id]).sort((a, b) => b.time - a.time);
    const lanes = [], pos = {};
    let maxLane = 0;
    list.forEach((c, row) => {
      let lane = lanes.indexOf(c.id);
      if (lane === -1) {
        lane = lanes.indexOf(null);
        if (lane === -1) { lane = lanes.length; lanes.push(null); }
      }
      for (let i = 0; i < lanes.length; i++) if (lanes[i] === c.id && i !== lane) lanes[i] = null;
      pos[c.id] = { row, lane };
      maxLane = Math.max(maxLane, lane);
      const ps = c.parents.filter((p) => seen.has(p));
      lanes[lane] = ps.length ? ps[0] : null;
      for (const p of ps.slice(1)) {
        if (lanes.includes(p)) continue;
        const j = lanes.indexOf(null);
        if (j === -1) lanes.push(p); else lanes[j] = p;
      }
      while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    });
    return { list, pos, maxLane };
  }

  function render(commits, refs, opts) {
    opts = opts || {};
    const { list, pos, maxLane } = layout(commits, refs);
    if (!list.length) return `<p class="empty">${esc(opts.empty || 'No commits yet')}</p>`;
    const width = PAD * 2 + maxLane * LANE;
    const height = list.length * ROW;
    const x = (lane) => PAD + lane * LANE;
    const y = (row) => row * ROW + ROW / 2;
    let edges = '', nodes = '';
    for (const c of list) {
      const { row, lane } = pos[c.id];
      c.parents.forEach((pid, i) => {
        const p = pos[pid];
        if (!p) return;
        const cx = x(lane), cy = y(row), px = x(p.lane), py = y(p.row);
        const color = `var(--lane${Math.max(lane, p.lane) % LANE_COLORS})`;
        let d;
        if (lane === p.lane) d = `M${cx} ${cy}V${py}`;
        else if (i === 0 && lane > p.lane) d = `M${cx} ${cy}V${py - ROW}C${cx} ${py - ROW / 2} ${px} ${py - ROW / 2} ${px} ${py}`;
        else d = `M${cx} ${cy}C${cx} ${cy + ROW / 2} ${px} ${cy + ROW / 2} ${px} ${cy + ROW}V${py}`;
        edges += `<path d="${d}" stroke="${color}" />`;
      });
    }
    const headId = (refs.find((r) => r.kind === 'head' || r.kind === 'current') || {}).id;
    for (const c of list) {
      const { row, lane } = pos[c.id];
      const isHead = c.id === headId;
      nodes += `<circle cx="${x(lane)}" cy="${y(row)}" r="${isHead ? 6 : 4.5}" fill="${isHead ? 'var(--bg-panel)' : `var(--lane${lane % LANE_COLORS})`}" stroke="var(--lane${lane % LANE_COLORS})" stroke-width="${isHead ? 3 : 1.5}" />`;
    }
    const rows = list.map((c) => {
      const pills = refs.filter((r) => r.id === c.id).map((r) => {
        if (r.kind === 'current') return `<span class="pill pill-head">HEAD → ${esc(r.name)}</span>`;
        return `<span class="pill pill-${r.kind}">${esc(r.name)}</span>`;
      }).join('');
      const merge = c.parents.length > 1 ? ' merge' : '';
      return `<div class="g-row${merge}" title="${esc(c.id)}\n${esc(c.author)}\n\n${esc(c.message)}">` +
        `${pills}<span class="g-hash">${c.id.slice(0, 7)}</span><span class="g-msg">${esc(c.message.split('\n')[0])}</span></div>`;
    }).join('');
    return `<div class="graph" style="--gw:${width}px"><svg class="g-svg" width="${width}" height="${height}" aria-hidden="true">` +
      `<g fill="none" stroke-width="2">${edges}</g>${nodes}</svg><div class="g-rows">${rows}</div></div>`;
  }

  function localRefs(repo) {
    const refs = [];
    const cur = repo.head.type === 'branch' ? repo.head.name : null;
    if (!cur) refs.push({ name: 'HEAD', id: repo.head.id, kind: 'head' });
    Object.keys(repo.branches).sort((a, b) => (a === cur ? -1 : b === cur ? 1 : a.localeCompare(b)))
      .forEach((b) => refs.push({ name: b, id: repo.branches[b], kind: b === cur ? 'current' : 'branch' }));
    Object.keys(repo.remoteRefs).sort().forEach((r) => refs.push({ name: r, id: repo.remoteRefs[r], kind: 'remote' }));
    return refs;
  }

  function serverRefs(server) {
    return Object.keys(server.branches).sort().map((b) => ({ name: b, id: server.branches[b], kind: 'branch' }));
  }

  root.GitGraph = { render, localRefs, serverRefs, esc };
})(window);
