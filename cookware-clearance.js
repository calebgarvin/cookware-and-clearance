/* My Solar Oven: Cookware & clearance.
   Shows whether a pan or pot fits in My Solar Oven at every spot on the rack and every
   rear leg setting. Runs entirely in the browser: no network requests, cookies or tracking.
   The fit engine, oven measurements and size list are copied from the ChatGPT guide by
   build.py. Edit src/ and run build.py rather than editing the built copies. */
(() => {
  /* ENGINE START (copied from my-solar-oven-guide by build.py) */
  const FitEngine = (() => {
    const product = { specifications: { cooking_chamber: {"interior_footprint": {"width": 14.25, "depth": 12.75, "unit": "in"}, "rack": {"width": 12.25, "depth": 8.625, "unit": "in", "note": "The rack has a rim on the left and right sides, so the base of a dish or pot must be 12¼ in wide or less. There is no rim at the front or back."}, "rack_to_walls": {"back": 1.125, "front": 3.125, "unit": "in", "note": "Measured at rack level from the rack's back and front edges to the chamber walls. Cookware can hang past the front or back of the rack into this space as long as it stays steady."}, "max_side_to_side": {"dish_or_pan": 13, "pot_with_lid": 13.75, "unit": "in", "note": "Overall width with handles, pointing left and right. Handles can sit above the rack's side rims, but the base must fit between them (12¼ in)."}, "rack_to_glass": {"standard": {"back": 10, "front": 7.5}, "low_sun": {"back": 11, "front": 5.5}, "leg_settings": 11, "unit": "in", "note": "Measured at the rack's back and front edges. standard is rear leg setting 1 (level); low_sun is setting 11 (fully extended). The rear leg has 11 evenly spaced settings, and the heights change in a straight line between them. The rack stays level, so tilting raises the glass at the back and lowers it at the front."}, "capacity_examples": ["A 6.5-quart Dutch oven (13 × 10.5 × 6.7 in), centered, up to rear leg setting 8 of 11", "An 11 × 7.5 in casserole dish", "A 9 × 13 in dish whose base fits between the rack rims (12¼ in) and whose handles keep it within 13 in"]} } };
    // Room to leave between the cookware and the glass or a chamber wall.
    const MARGIN = 0.25;
    // A pot's lid is lower at its front edge than at the knob. Set from a test with a
    // 6.5-quart Dutch oven (13 × 10.5 × 6.7 in, centered on the rack): it fit with room to
    // spare at rear leg setting 8 and was too close at 9. That puts the front of the lid at
    // about 78% of the pot's overall height.
    const LID_EDGE_SHARE = 0.78;
    // Cookware can hang past the front or back of the rack, which has no rim there, but its
    // center has to stay at least this far in from the rack's edge so it can't tip.
    const STEADY = 1;
    const EPS = 1e-9;
    const rank = ['too_big', 'too_tall', 'overhangs_rack', 'tight', 'fits'];
    const placements = ['back', 'center', 'front'];
    const round = value => Math.round(value * 100) / 100;
    const oneDecimal = value => (Math.round(value * 10) / 10).toFixed(1);
    const nice = value => {
      const whole = Math.floor(value + EPS);
      const part = { 0: '', 0.125: '⅛', 0.25: '¼', 0.375: '⅜', 0.5: '½', 0.625: '⅝', 0.75: '¾', 0.875: '⅞' }[Math.round((value - whole) * 1000) / 1000];
      return part === undefined ? String(round(value)) : `${whole || ''}${part}` || '0';
    };
    const toInches = (value, unit) => unit === 'cm' ? value / 2.54 : value;
    const where = { back: 'pushed to the back of the rack', center: 'in the middle of the rack', front: 'at the front of the rack' };
    const settingsText = ({ from, to }) => from === to ? `leg setting ${from}` : `leg settings ${from} to ${to}`;

    // Glass height above the rack at d inches forward of the rack's back edge. The rear leg
    // has evenly spaced settings from 1 (level) to the last (fully extended), and the glass
    // heights change in a straight line between the two measured positions. The rack stays
    // level, so tilting raises the glass at the back and lowers it at the front.
    function glassAt(chamber, legSetting) {
      const { standard, low_sun: full, leg_settings: steps } = chamber.rack_to_glass;
      const t = (legSetting - 1) / (steps - 1);
      const back = standard.back + t * (full.back - standard.back);
      const front = standard.front + t * (full.front - standard.front);
      const slope = (back - front) / chamber.rack.depth;
      return d => back - slope * d;
    }

    // Where the cookware's back edge sits, in inches forward of the rack's back edge
    // (negative means it hangs past the back). Back: slid as far back as it goes. Middle:
    // centered on the rack. Front: front edge at the rack's front edge, or for cookware
    // deeper than the rack, back edge at the rack's back edge so the extra hangs off the front.
    function backEdge(depth, placement, chamber) {
      const { rack, rack_to_walls: walls } = chamber;
      const furthestBack = Math.max(-(walls.back - MARGIN), STEADY - depth / 2);
      const furthestForward = Math.min(rack.depth + walls.front - MARGIN - depth, rack.depth - STEADY - depth / 2);
      const wanted = placement === 'back' ? -Infinity
        : placement === 'center' ? (rack.depth - depth) / 2
        : Math.max(rack.depth - depth, 0);
      return Math.min(Math.max(wanted, furthestBack), furthestForward);
    }

    // Rectangular dishes are checked at their front edge, where the glass is lowest. Round
    // pots are checked at the knob in the middle and at the front edge of the lid.
    // Side to side, the base has to fit between the rack's rims; handles can sit above them.
    function evaluate(item, chamber, legSetting, placement) {
      const { rack, rack_to_walls: walls, max_side_to_side: maxAcross } = chamber;
      const glass = glassAt(chamber, legSetting);
      const maxDepth = rack.depth + walls.back + walls.front - 2 * MARGIN;
      const isRound = item.shape === 'round';
      // A round pot sits with its handles left and right: length is handle to handle and
      // width is the body, which is what has to fit between the rims.
      const layouts = isRound
        ? [{ rotation: 90, depth: Math.min(item.length, item.width), across: Math.max(item.length, item.width), base: Math.min(item.length, item.width) }]
        : [0, 90].map(rotation => {
          const depth = rotation ? item.width : item.length;
          const across = rotation ? item.length : item.width;
          return { rotation, depth, across, base: across };
        });
      const options = layouts.map(({ rotation, depth, across, base }) => {
        const widest = isRound ? maxAcross.pot_with_lid : maxAcross.dish_or_pan;
        const footprint = depth <= maxDepth + EPS && across <= widest + EPS && (isRound ? base <= rack.width + EPS : true);
        const needsHandles = !isRound && across > rack.width + EPS;
        const spareWidth = rack.width - (isRound ? base : Math.min(across, rack.width));
        const offset = footprint ? backEdge(depth, placement, chamber) : 0;
        const points = isRound
          ? [{ at: offset + depth / 2, height: item.height, spot: 'middle of the pot' }, { at: offset + depth, height: item.height * LID_EDGE_SHARE, spot: 'front edge of the lid' }]
          : [{ at: offset + depth, height: item.height, spot: 'front edge of the dish' }];
        const check = points
          .map(point => ({ ...point, glassHeight: glass(point.at), room: glass(point.at) - point.height }))
          .reduce((a, b) => b.room < a.room - EPS ? b : a);
        let status;
        if (!footprint) status = 'too_big';
        else if (check.room < -EPS) status = 'too_tall';
        else if (needsHandles) status = 'overhangs_rack';
        else if (check.room >= MARGIN - EPS) status = 'fits';
        else status = 'tight';
        return { rotation, depth, across, offset, at: check.at, spot: check.spot, checkedHeight: check.height, glassHeight: check.glassHeight, headroom: check.room, spareWidth, footprint, status };
      });
      // Best result first, then the way round with more room under the glass. That usually
      // means the long side left to right, fully on the rack.
      return options.sort((a, b) => rank.indexOf(b.status) - rank.indexOf(a.status) || b.headroom - a.headroom)[0];
    }

    function verb(status) {
      return status === 'fits' ? 'fit' : status === 'tight' ? 'just fit' : 'fit, if its base is narrow enough,';
    }

    function summarize({ best, alternative, room, legSetting, placement, chamber, tallEverywhere, highest }) {
      const { rack, rack_to_walls: walls, max_side_to_side: maxAcross } = chamber;
      const rangeFor = spot => room[spot] ? ` at ${settingsText(room[spot])}` : '';
      let better = '';
      if (alternative) {
        const when = rangeFor(alternative.placement) || ` at leg setting ${alternative.leg_setting}`;
        better = alternative.placement === placement
          ? ` In this spot it would ${verb(alternative.status)}${when}.`
          : alternative.leg_setting === legSetting && !room[alternative.placement]
            ? ` It would ${verb(alternative.status)} ${where[alternative.placement]} at this leg setting.`
            : ` It would ${verb(alternative.status)} ${where[alternative.placement]}${when}.`;
      }
      const settings = room[placement] && !(room[placement].from === 1 && room[placement].to === chamber.rack_to_glass.leg_settings)
        ? ` In this spot it has room at ${settingsText(room[placement])}.` : '';
      if (tallEverywhere) {
        return `It's too tall for My Solar Oven in any spot and at any leg setting. Its best spot is ${where[highest.placement]} at leg setting ${highest.leg_setting}, where the glass is about ${oneDecimal(highest.glassHeight)} in above the rack over the ${highest.spot}.`;
      }
      switch (best.status) {
        case 'fits':
          return `It should fit, with about ${oneDecimal(best.headroom)} in of room between the glass and the ${best.spot}.${settings}`;
        case 'tight':
          return `It fits, but with less than ¼ in to spare under the glass, so it may be hard to get in and out.${better}`;
        case 'overhangs_rack':
          return `It's wider than the ${nice(rack.width)} in between the rack's side rims. That works only if the extra width is handles or a flared rim that sit above the rims, with a base ${nice(rack.width)} in wide or less.${settings}`;
        case 'too_tall':
          return `The glass is too low here. Over the ${best.spot} it sits about ${oneDecimal(best.glassHeight)} in above the rack.${better || ' It is too tall for any spot at this leg setting.'}`;
        default:
          return `It's too big for My Solar Oven. The base has to fit between the rack's side rims, ${nice(rack.width)} in apart. With handles, dishes and pans can be up to ${nice(maxAcross.dish_or_pan)} in side to side and pots up to ${nice(maxAcross.pot_with_lid)} in. Front to back there's about ${nice(rack.depth + walls.back + walls.front - 2 * MARGIN)} in between the walls.`;
      }
    }

    function checkFit({ cookware, shape = 'rectangular', leg_setting = 1, placement = 'back' }) {
      if (!cookware || !['in', 'cm'].includes(cookware.unit) || !['length', 'width', 'height'].every(axis => Number.isFinite(cookware[axis]) && cookware[axis] > 0)) {
        throw new Error('Give the outside length, width and height in inches or centimeters, including handles and the lid knob.');
      }
      const chamber = product.specifications.cooking_chamber;
      const steps = chamber.rack_to_glass.leg_settings;
      if (!['rectangular', 'round'].includes(shape) || !placements.includes(placement) || !Number.isInteger(leg_setting) || leg_setting < 1 || leg_setting > steps) {
        throw new Error(`Choose a supported shape, rack placement and a rear leg setting from 1 to ${steps}.`);
      }
      const item = { shape, ...Object.fromEntries(['length', 'width', 'height'].map(axis => [axis, toInches(cookware[axis], cookware.unit)])) };
      const settings = Array.from({ length: steps }, (_, i) => i + 1);
      const grid = Object.fromEntries(placements.map(spot => [spot, settings.map(k => ({ ...evaluate(item, chamber, k, spot), leg_setting: k, placement: spot }))]));
      const all = Object.values(grid).flat();
      const best = grid[placement][leg_setting - 1];
      const tallEverywhere = best.footprint && all.every(entry => entry.status === 'too_tall');
      const status = tallEverywhere ? 'too_big' : best.status;
      // Leg settings with at least ¼ in to spare above the cookware, for each spot.
      const room = Object.fromEntries(placements.map(spot => {
        const ok = grid[spot].filter(entry => entry.footprint && entry.headroom >= MARGIN - EPS).map(entry => entry.leg_setting);
        return [spot, ok.length ? { from: Math.min(...ok), to: Math.max(...ok) } : null];
      }));
      let alternative = null;
      if (status !== 'fits' && status !== 'too_big') {
        const floor = Math.max(rank.indexOf(status), rank.indexOf('too_tall'));
        const pick = all.filter(entry => rank.indexOf(entry.status) > floor)
          // Prefer the best result, then the closest leg setting, then the same spot.
          .sort((a, b) => rank.indexOf(b.status) - rank.indexOf(a.status) || Math.abs(a.leg_setting - leg_setting) - Math.abs(b.leg_setting - leg_setting) || (b.placement === placement) - (a.placement === placement))[0];
        if (pick) alternative = { placement: pick.placement, leg_setting: pick.leg_setting, status: pick.status };
      }
      const highest = all.reduce((a, b) => b.glassHeight - b.checkedHeight > a.glassHeight - a.checkedHeight ? b : a);
      const { rack } = chamber;
      return {
        status,
        fits: status === 'fits' ? true : ['too_big', 'too_tall'].includes(status) ? false : null,
        summary: summarize({ best, alternative, room, legSetting: leg_setting, placement, chamber, tallEverywhere, highest }),
        leg_setting,
        placement,
        orientation: shape === 'round' ? 'Handles left and right' : best.rotation ? 'Width runs front to back' : 'Length runs front to back',
        headroom_in: round(best.headroom),
        glass_height_in: round(best.glassHeight),
        glass_height_measured_at: best.spot,
        cookware_height_there_in: round(best.checkedHeight),
        room_at_leg_settings: room[placement],
        headroom_by_leg_setting_in: grid[placement].map(entry => round(entry.headroom)),
        spare_width_between_rims_in: round(best.spareWidth),
        layout: { front_to_back_in: round(best.depth), side_to_side_in: round(best.across), from_rack_back_in: round(best.offset) },
        hangs_past_rack_in: { back: round(Math.max(0, -best.offset)), front: round(Math.max(0, best.offset + best.depth - rack.depth)) },
        ...(alternative ? { better_option: alternative } : {}),
        cookware: { ...cookware, shape },
        note: `Estimate from the measured rack, wall and glass heights, leaving ¼ in of room above and at the walls. Rear leg settings run from 1 (level) to ${steps} (fully extended).${shape === 'round' ? ' The front of the lid is taken as 78% of the overall height, from a test with a 6.5-quart Dutch oven.' : ''} Try the dish in the cold, empty oven before you cook.`
      };
    }
    return { checkFit, glassAt, LID_EDGE_SHARE, chamber: product.specifications.cooking_chamber };
  })();
  const PRESETS = [{"group": "Baking dishes and pans", "items": [{"id": "casserole-11x7", "name": "11 × 7 in casserole dish", "size": [11, 7.5, 2.5], "shape": "rectangular"}, {"id": "pan-8x8", "name": "8 × 8 in square pan", "size": [9, 9, 2.25], "shape": "rectangular"}, {"id": "pan-9x13-metal", "name": "9 × 13 in metal pan", "size": [13.625, 9.5, 2.25], "shape": "rectangular"}, {"id": "dish-9x13-glass", "name": "9 × 13 in glass dish with handles", "size": [16.25, 9.5, 2.25], "shape": "rectangular"}, {"id": "quarter-sheet", "name": "Quarter sheet pan", "size": [12.9, 9.6, 1.1], "shape": "rectangular"}, {"id": "round-9", "name": "9 in round cake pan", "size": [9.5, 9.5, 2], "shape": "rectangular"}, {"id": "pie-9", "name": "9½ in deep pie dish", "size": [9.5, 9.5, 2.6], "shape": "rectangular"}, {"id": "loaf-9x5", "name": "9 × 5 in loaf pan", "size": [9.625, 5.625, 2.75], "shape": "rectangular"}, {"id": "muffin-6", "name": "6-cup muffin pan", "size": [11.125, 9, 1.375], "shape": "rectangular"}]}, {"group": "Pots with lids", "items": [{"id": "dutch-2", "name": "2-quart Dutch oven", "size": [10.625, 7.8125, 5], "shape": "round"}, {"id": "dutch-3", "name": "3-quart Dutch oven", "size": [12.5625, 9.5, 6.0625], "shape": "round"}, {"id": "dutch-5", "name": "5-quart Dutch oven", "size": [12.625, 10.375, 6.3125], "shape": "round"}, {"id": "dutch-6", "name": "6-quart Dutch oven", "size": [13.5625, 10.5, 7.3125], "shape": "round"}, {"id": "dutch-6-5", "name": "6½-quart Dutch oven", "size": [13, 10.5, 6.7], "shape": "round"}]}];
  /* ENGINE END */

  const PRESET_BY_ID = Object.fromEntries(PRESETS.flatMap(group => group.items).map(item => [item.id, item]));
  const chamber = FitEngine.chamber;
  const LEGS = chamber.rack_to_glass.leg_settings;
  const HALF = Math.round((LEGS + 1) / 2);
  const ROWS = [[1, 'Level'], [HALF, 'Half tilt'], [LEGS, 'Full tilt']];
  const PLACEMENTS = [['back', 'Back'], ['center', 'Middle'], ['front', 'Front']];
  const PLACE_WORD = { back: 'Slid all the way back', center: 'Centered on the rack', front: 'At the front of the rack' };
  const VERDICT = { fits: 'Fits here', tight: 'Fits, but only just', overhangs_rack: 'Fits if the base is 12¼ in or less', too_tall: 'Touches the glass here', too_big: 'Too big for this oven' };
  const SVG = 'http://www.w3.org/2000/svg';

  const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };
  const svgNode = (tag, attrs, text) => {
    const node = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const tone = status => status === 'fits' ? '--cw-accent' : ['tight', 'overhangs_rack'].includes(status) ? '--cw-sun' : '--cw-no';
  const shapeStyle = status => `fill:var(${tone(status)});fill-opacity:.25;stroke:var(${tone(status)});stroke-width:2`;
  const legRange = r => r.from === r.to ? `leg setting ${r.from}` : `leg settings ${r.from} to ${r.to}`;
  const tallEverywhere = result => result.status === 'too_big' && /too tall/.test(result.summary);
  const drawable = result => result && (result.status !== 'too_big' || tallEverywhere(result));

  function initSection(root) {
    if (root.dataset.cwReady) return;
    root.dataset.cwReady = 'true';
    const $ = name => root.querySelector(`[data-cw="${name}"]`);
    const shapeInputs = [...root.querySelectorAll('[data-cw="shape"]')];
    const dimInputs = ['length', 'width', 'height'].map($);
    const state = { preset: 'casserole-11x7', shape: 'rectangular', unit: 'in', dims: [11, 7.5, 2.5], setting: 1, placement: 'back' };
    const fmt = inches => state.unit === 'cm' ? `${(inches * 2.54).toFixed(1)} cm` : `${(Math.round(inches * 10) / 10).toFixed(1)} in`;
    const show = inches => String(state.unit === 'cm' ? Math.round(inches * 2.54 * 10) / 10 : Math.round(inches * 100) / 100);

    for (const group of PRESETS) {
      const optgroup = el('optgroup', { label: group.group });
      for (const item of group.items) optgroup.append(new Option(item.name, item.id));
      $('preset').append(optgroup);
    }
    const cells = {};
    for (const [setting, label] of ROWS) {
      $('grid').append(el('span', { className: 'cw-row' }, label, el('small', { textContent: `Leg ${setting}` })));
      for (const [placement] of PLACEMENTS) {
        const cell = el('button', { type: 'button', className: 'cw-cell' });
        cell.addEventListener('click', () => { Object.assign(state, { setting, placement }); render(); });
        cells[`${setting}|${placement}`] = cell;
        $('grid').append(cell);
      }
    }
    const steps = Array.from({ length: LEGS }, (_, i) => {
      const step = el('button', { type: 'button', className: 'cw-step', textContent: String(i + 1) });
      step.addEventListener('click', () => { state.setting = i + 1; render(); });
      $('strip').append(step);
      return step;
    });

    function drawSide(item, result) {
      // Side profile of the chamber at rack level. d is inches forward of the rack's back edge, h is inches above it.
      const svg = $('side'), s = 13, W = 230, y0 = 174;
      const rackD = chamber.rack.depth, { back: wallBack, front: wallFront } = chamber.rack_to_walls;
      const x0 = 18 + wallBack * s;
      const X = d => x0 + d * s, Y = h => y0 - h * s;
      const glassAt = FitEngine.glassAt(chamber, state.setting);
      const angle = Math.atan((glassAt(0) - glassAt(rackD)) / rackD) * 180 / Math.PI;
      const label = (x, y, text, extra = {}) => svgNode('text', { x, y, class: 'cw-label', ...extra }, text);
      const backWall = -wallBack, frontWall = rackD + wallFront;
      svg.replaceChildren(
        svgNode('line', { x1: X(backWall), y1: y0, x2: X(backWall), y2: Y(glassAt(backWall)), class: 'cw-wall' }),
        svgNode('line', { x1: X(frontWall), y1: y0, x2: X(frontWall), y2: Y(glassAt(frontWall)), class: 'cw-wall' }),
        svgNode('line', { x1: X(0), y1: y0, x2: X(rackD), y2: y0, class: 'cw-rack' })
      );
      const front = [];
      if (item && drawable(result)) {
        const { front_to_back_in: depth, from_rack_back_in: offset } = result.layout;
        const left = X(offset), right = X(offset + depth), style = shapeStyle(result.status), h = item.height;
        if (item.shape === 'round') {
          // Pot body up to the front of the lid, a domed lid and a knob. The dome stays under
          // the two points the fit engine checks (knob in the middle, lid at the front edge).
          const rim = h * FitEngine.LID_EDGE_SHARE, peak = rim + (h - rim) * 0.4, control = 2 * peak - rim, mid = (left + right) / 2;
          const knob = Math.min(1.4, depth * 0.15) * s;
          svg.append(
            svgNode('path', { d: `M${left} ${y0}V${Y(rim)}Q${mid} ${Y(control)} ${right} ${Y(rim)}V${y0}Z`, style, 'stroke-linejoin': 'round' }),
            svgNode('line', { x1: left, y1: Y(rim), x2: right, y2: Y(rim), style: style.replace(/fill[^;]*;/g, '') + ';stroke-opacity:.6;stroke-width:1.5' }),
            svgNode('rect', { x: mid - knob / 2, y: Y(h), width: knob, height: Y(peak) - Y(h) + 1, rx: 2, style: style.replace('fill-opacity:.25', 'fill-opacity:1') })
          );
        } else {
          svg.append(svgNode('rect', { x: left, y: Y(h), width: right - left, height: y0 - Y(h), rx: 2, style }));
        }
        const cx = result.glass_height_measured_at.startsWith('middle') ? (left + right) / 2 : right - 4;
        const top = Y(result.cookware_height_there_in), glass = Y(result.glass_height_in), room = result.headroom_in;
        const text = room > 0.05 ? fmt(room) : room < -0.05 ? `${fmt(-room)} too tall` : 'Touching';
        const width = text.length * 6.2;
        if (room > 0.05) {
          // Room to spare: a dashed line from the cookware up to the glass, labeled beside it.
          const toRight = cx + 7 + width < W;
          front.push(svgNode('line', { x1: cx, y1: top, x2: cx, y2: glass, class: 'cw-gap' }),
            label(toRight ? cx + 7 : cx - 7, (top + glass) / 2 + 4, text, { class: 'cw-label cw-label--strong', 'text-anchor': toRight ? 'start' : 'end' }));
        } else {
          // Touching or too tall: mark where it meets the glass and label just below that point.
          const toLeft = cx - 8 - width > 4;
          front.push(svgNode('circle', { cx, cy: glass, r: 4, class: 'cw-contact' }),
            label(toLeft ? cx - 8 : cx + 8, glass + 18, text, { class: 'cw-label cw-label--strong', 'text-anchor': toLeft ? 'end' : 'start' }));
        }
      }
      const gx = X(backWall + 0.5), gy = Y(glassAt(backWall + 0.5)) + 15;
      svg.append(
        svgNode('line', { x1: X(backWall), y1: Y(glassAt(backWall)), x2: X(frontWall), y2: Y(glassAt(frontWall)), class: 'cw-glass' }),
        label(gx, gy, 'Glass', { transform: `rotate(${angle} ${gx} ${gy})` }),
        label(X(backWall), y0 + 16, 'Back', { 'text-anchor': 'middle' }),
        label(X(rackD / 2), y0 + 16, 'Rack', { 'text-anchor': 'middle' }),
        label(X(frontWall), y0 + 16, 'Front', { 'text-anchor': 'middle' }),
        ...front
      );
    }

    function drawTop(item, result) {
      // Chamber at rack level from above. The rack has rims on the left and right (solid) and is open front and back (dashed).
      const svg = $('top'), s = 11.5, x0 = 12, y0 = 18;
      const { rack, rack_to_walls: walls } = chamber, floorW = chamber.interior_footprint.width, floorD = rack.depth + walls.back + walls.front;
      const rackX = x0 + (floorW - rack.width) / 2 * s, rackY = y0 + walls.back * s, rackR = rackX + rack.width * s, rackB = rackY + rack.depth * s;
      svg.replaceChildren(
        svgNode('rect', { x: x0, y: y0, width: floorW * s, height: floorD * s, rx: 6, class: 'cw-floor' }),
        svgNode('line', { x1: rackX, y1: rackY, x2: rackR, y2: rackY, class: 'cw-rack-open' }),
        svgNode('line', { x1: rackX, y1: rackB, x2: rackR, y2: rackB, class: 'cw-rack-open' }),
        svgNode('line', { x1: rackX, y1: rackY, x2: rackX, y2: rackB, class: 'cw-rim' }),
        svgNode('line', { x1: rackR, y1: rackY, x2: rackR, y2: rackB, class: 'cw-rim' }),
        svgNode('text', { x: x0 + floorW * s / 2, y: y0 - 6, class: 'cw-label', 'text-anchor': 'middle' }, 'Back'),
        svgNode('text', { x: x0 + floorW * s / 2, y: y0 + floorD * s + 15, class: 'cw-label', 'text-anchor': 'middle' }, 'Front')
      );
      if (!item || !drawable(result)) return;
      const { front_to_back_in: depth, side_to_side_in: across, from_rack_back_in: offset } = result.layout;
      const w = Math.min(across, floorW + 2) * s, d = Math.min(depth, floorD + 2) * s;
      const x = x0 + floorW * s / 2 - w / 2, y = rackY + offset * s;
      if (item.shape === 'round') {
        const r = Math.min(w, d) / 2, cy = y + d / 2;
        svg.append(svgNode('ellipse', { cx: x + w / 2, cy, rx: r, ry: d / 2, style: shapeStyle(result.status) }));
        // Handles stick out left and right.
        if (w > d) for (const [a, b] of [[x, x + w / 2 - r], [x + w / 2 + r, x + w]]) svg.append(svgNode('line', { x1: a, y1: cy, x2: b, y2: cy, style: shapeStyle(result.status).replace('stroke-width:2', 'stroke-width:4;stroke-linecap:round') }));
      } else {
        svg.append(svgNode('rect', { x, y, width: w, height: d, rx: 3, style: shapeStyle(result.status) }));
      }
    }

    function render() {
      $('preset').value = state.preset ?? '';
      shapeInputs.forEach(input => { input.checked = input.value === state.shape; });
      $('unit').value = state.unit;
      dimInputs.forEach((input, i) => { if (document.activeElement !== input) input.value = Number.isFinite(state.dims[i]) ? show(state.dims[i]) : ''; });
      const preset = PRESET_BY_ID[state.preset];
      $('preset-note').textContent = preset
        ? `Typical outside size: ${preset.size.map(v => String(Math.round((state.unit === 'cm' ? v * 2.54 : v) * 10) / 10)).join(' × ')} ${state.unit}${preset.shape === 'round' ? ', handle to handle' : ''}.${preset.note ? ` ${preset.note}` : ' Yours may differ, so measure if you can.'}`
        : 'Outside size, handles and lid knob included. For a pot, width is the body without the handles.';
      const complete = state.dims.every(v => Number.isFinite(v) && v > 0);
      const item = complete ? { length: state.dims[0], width: state.dims[1], height: state.dims[2], shape: state.shape } : null;
      const run = (setting, placement) => FitEngine.checkFit({ cookware: { length: item.length, width: item.width, height: item.height, unit: 'in' }, shape: item.shape, leg_setting: setting, placement });
      const said = result => result.status === 'too_big' ? 'too big' : result.status === 'too_tall' ? 'too tall' : `${fmt(result.headroom_in)} of room`;
      for (const [setting, rowLabel] of ROWS) for (const [placement, placeLabel] of PLACEMENTS) {
        const cell = cells[`${setting}|${placement}`];
        cell.setAttribute('aria-pressed', String(setting === state.setting && placement === state.placement));
        if (!item) { cell.textContent = '–'; cell.disabled = true; cell.removeAttribute('data-status'); continue; }
        const result = run(setting, placement);
        cell.disabled = false;
        cell.dataset.status = result.status;
        cell.textContent = result.status === 'too_big' ? 'Too big' : result.status === 'too_tall' ? 'Too tall' : result.headroom_in < 0.05 ? 'Just fits' : fmt(result.headroom_in);
        cell.setAttribute('aria-label', `${rowLabel}, leg setting ${setting}, ${placeLabel.toLowerCase()} of the rack: ${said(result)}`);
      }
      const selected = item ? run(state.setting, state.placement) : null;
      const placeLabel = PLACEMENTS.find(([p]) => p === state.placement)[1].toLowerCase();
      $('legs-title').textContent = `Every leg setting, ${placeLabel === 'middle' ? 'middle of the rack' : `${placeLabel} of the rack`}`;
      steps.forEach((step, i) => {
        step.setAttribute('aria-pressed', String(i + 1 === state.setting));
        if (!item) { step.disabled = true; step.removeAttribute('data-status'); step.setAttribute('aria-label', `Leg setting ${i + 1}`); return; }
        const result = i + 1 === state.setting ? selected : run(i + 1, state.placement);
        step.disabled = false;
        step.dataset.status = result.status;
        step.setAttribute('aria-label', `Leg setting ${i + 1}: ${said(result)}`);
      });
      drawSide(item, selected);
      drawTop(item, selected);
      const verdict = $('verdict');
      if (!selected) {
        verdict.textContent = 'Enter a size or pick one from the list';
        verdict.removeAttribute('data-status');
        $('why').textContent = 'The glass is highest at the back of the rack and lowest at the front.';
        $('summary').textContent = '';
        $('legs-note').textContent = '';
        return;
      }
      verdict.textContent = tallEverywhere(selected) ? 'Too tall for this oven' : VERDICT[selected.status];
      verdict.dataset.status = selected.status;
      const range = selected.room_at_leg_settings;
      $('legs-note').textContent = selected.status === 'too_big' ? '' : range
        ? `In this spot it has room to spare at ${legRange(range)}${range.from === 1 && range.to === LEGS ? ', every setting' : ''}.`
        : 'In this spot it doesn\'t have room to spare at any leg setting.';
      const hang = selected.hangs_past_rack_in;
      const hangs = [hang.back > 0.05 && `${fmt(hang.back)} past the back`, hang.front > 0.05 && `${fmt(hang.front)} past the front`].filter(Boolean);
      const where = `${PLACE_WORD[state.placement]} with the rear leg on setting ${state.setting} of ${LEGS}, the glass sits ${fmt(selected.glass_height_in)} above the rack over the ${selected.glass_height_measured_at}.`;
      const lid = selected.glass_height_measured_at === 'front edge of the lid';
      const tall = lid ? `The front of the lid is about ${fmt(selected.cookware_height_there_in)} up` : `Your cookware is ${fmt(item.height)} tall`;
      const knob = lid ? ' The knob is higher, but it sits in the middle, where the glass is higher too.' : '';
      const overhang = hangs.length ? ` It hangs ${hangs.join(' and ')} of the rack, which is fine.` : '';
      const room = selected.headroom_in;
      $('why').textContent = selected.status === 'too_big'
        ? selected.summary
        : `${where} ${tall}, ${room >= 0.05 ? `which leaves ${fmt(room)} of room.` : room >= 0 ? 'which leaves almost no room.' : room > -0.05 ? 'so it touches the glass.' : `so it's ${fmt(-room)} too tall.`}${knob}${overhang}`;
      $('summary').textContent = ['fits', 'too_big'].includes(selected.status) ? '' : selected.summary;
    }

    $('preset').addEventListener('change', event => {
      const preset = PRESET_BY_ID[event.target.value];
      state.preset = preset ? preset.id : '';
      if (preset) Object.assign(state, { dims: [...preset.size], shape: preset.shape });
      render();
    });
    dimInputs.forEach((input, i) => input.addEventListener('input', () => {
      const value = parseFloat(input.value);
      state.dims[i] = Number.isFinite(value) ? (state.unit === 'cm' ? value / 2.54 : value) : NaN;
      state.preset = '';
      render();
    }));
    shapeInputs.forEach(input => input.addEventListener('change', () => { state.shape = shapeInputs.find(x => x.checked).value; state.preset = ''; render(); }));
    $('unit').addEventListener('change', event => { state.unit = event.target.value; render(); });
    $('form').addEventListener('submit', event => event.preventDefault());
    render();
  }

  function initAll(scope) { (scope || document).querySelectorAll('[data-mso-cw]').forEach(initSection); }
  window.MySolarOvenCookware = { init: initAll, checkFit: FitEngine.checkFit };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initAll());
  else initAll();
  // The Shopify theme editor re-renders a section when its settings change.
  document.addEventListener('shopify:section:load', event => initAll(event.target));
})();
