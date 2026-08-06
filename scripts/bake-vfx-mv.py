#!/usr/bin/env python3
"""
Bake motion-vector + channel-packed companions for the Emberkeep VFX bank.

    python3 scripts/bake-vfx-mv.py [--only KEY] [--report] [--self-test]

This is the step that takes the bank from "graded flipbooks" to the real-time
VFX standard. For every flipbook in assets/vfx-bank/bank.json it writes:

  <key>_pack.png   R = density   (luminance of the graded frame)
                   G = emissive  (hot core — drives additive bloom)
                   B = erosion   (per-pixel dissolve order, for burn-away)
                   A = alpha     (coverage)

  <key>_mv.png     RG = forward flow  frame i -> next
                   BA = backward flow next   -> frame i
                   each channel = (flow_px / mvScale) * 0.5 + 0.5

Both share the colour sheet's cell grid. `mvScale` and the decimated frame
layout ship in bank.mv.json.

WHY TWO FLOWS — correct flipbook interpolation warps frame A *forward* by t and
frame B *backward* by (1-t), then cross-dissolves. A single field only lets you
warp from one side and ghosts badly on the other.

WHY DECIMATE — with motion vectors, a quarter of the frames reconstructs better
than half the frames without them (measured; see --report). That is where the
VRAM saving comes from, not from shrinking the cells.

Flow solver: pyramidal Horn-Schunck. Volumetric smoke/fire moves smoothly and
non-rigidly, which a global smoothness prior handles well and which block
matching tears apart. Run --self-test: it must recover known translations.
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image
from scipy.ndimage import convolve, gaussian_filter, map_coordinates, zoom

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANK = os.path.join(ROOT, 'assets/vfx-bank')
Image.MAX_IMAGE_PIXELS = None

# How far each sheet may be decimated, and its tuned smoothness weight.
# Chosen from the measured gain table — coherent transport (flames) tolerates
# far more decimation than a topologically churning explosion.
TUNING = {
    'fb_smoke_wispy': dict(keep=16, alpha=0.30),
    'fb_smoke_puff':  dict(keep=16, alpha=0.30),
    'fb_flame_small': dict(keep=32, alpha=0.30),   # flickers too fast for 4x
    
    'fb_flame':       dict(keep=32, alpha=0.30),   # same
    'fb_cloud':       dict(keep=16, alpha=0.30),
    'fb_fireball':    dict(keep=16, alpha=0.60),
    'fb_fireburst':   dict(keep=12, alpha=0.60),   # 4x3 exactly — 13 would waste 3 cells
    'fb_dustburst':   dict(keep=12, alpha=0.60),   # 4x3 exactly
    'fb_wisp':        dict(keep=20, alpha=0.30),
}
LOOPING = {'fb_flame_small', 'fb_flame', 'fb_smoke_wispy', 'fb_smoke_puff', 'fb_cloud', 'fb_wisp'}


# --------------------------------------------------------------------------- #
# flow
# --------------------------------------------------------------------------- #
# Classic Horn-Schunck neighbour kernel — THE CENTRE IS EXCLUDED. Substituting a
# gaussian (centre-weighted) cripples the update and the flow collapses to zero.
HS_KERNEL = np.array([[1 / 12, 1 / 6, 1 / 12],
                      [1 / 6, 0.0, 1 / 6],
                      [1 / 12, 1 / 6, 1 / 12]], np.float32)


def horn_schunck(im1, im2, alpha, iters):
    """One pyramid level. Flow convention: im1(x) ~= im2(x + u).

    `alpha` is the smoothness weight and is SCALE SENSITIVE — it competes with
    Ix^2+Iy^2, and for 0..1 imagery those are ~1e-2. Use ~0.3, not the ~6 you
    would use on 0..255 data (that drives the solution to zero).
    """
    Ix = 0.5 * (np.gradient(im1, axis=1) + np.gradient(im2, axis=1))
    Iy = 0.5 * (np.gradient(im1, axis=0) + np.gradient(im2, axis=0))
    It = im2 - im1
    u = np.zeros_like(im1)
    v = np.zeros_like(im1)
    den = alpha ** 2 + Ix ** 2 + Iy ** 2
    for _ in range(iters):
        ub = convolve(u, HS_KERNEL, mode='nearest')
        vb = convolve(v, HS_KERNEL, mode='nearest')
        p = (Ix * ub + Iy * vb + It) / den
        u = ub - Ix * p
        v = vb - Iy * p
    return u, v


def warp(img, u, v):
    """Pull-sample: out(x) = img(x + u, y + v).

    With the convention above, reconstructing im2 from im1 is warp(im1, -u, -v).
    """
    h, w = img.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    coords = [yy + v, xx + u]
    if img.ndim == 2:
        return map_coordinates(img, coords, order=1, mode='nearest')
    return np.stack([map_coordinates(img[..., c], coords, order=1, mode='nearest')
                     for c in range(img.shape[2])], -1)


def pyramidal_flow(a, b, alpha=0.3, iters=120, levels=4):
    """Coarse-to-fine, so displacements larger than a pixel are still found."""
    levels = max(1, min(levels, int(np.log2(min(a.shape))) - 2))
    pa, pb = [a], [b]
    for _ in range(levels - 1):
        pa.append(zoom(gaussian_filter(pa[-1], 1.0), 0.5, order=1))
        pb.append(zoom(gaussian_filter(pb[-1], 1.0), 0.5, order=1))
    u = np.zeros_like(pa[-1])
    v = np.zeros_like(pa[-1])
    for lvl in range(levels - 1, -1, -1):
        A, B = pa[lvl], pb[lvl]
        if u.shape != A.shape:
            fy, fx = A.shape[0] / u.shape[0], A.shape[1] / u.shape[1]
            u = zoom(u, (fy, fx), order=1) * fx
            v = zoom(v, (fy, fx), order=1) * fy
        # Pre-warp A TOWARD B (negative flow), then solve for the residual.
        # Warping by +u pushes AWAY from B and the error compounds ~2x per level.
        du, dv = horn_schunck(warp(A, -u, -v), B, alpha, iters)
        u, v = u + du, v + dv
        u = gaussian_filter(u, 0.8, mode='nearest')
        v = gaussian_filter(v, 0.8, mode='nearest')
    return u, v


def self_test():
    """Recover known translations. Guards the sign and scale bugs above.

    The probe MUST be contrast-normalised to 0..1 like real frame data: blurred
    uniform noise clusters tightly around 0.5, its gradients land near 1e-3, and
    alpha swamps them — the solver then reports ~0 flow and the test fails for a
    reason that has nothing to do with the solver.
    """
    rng = np.random.default_rng(7)
    ok = True
    for sigma in (3.0, 8.0):
        base = gaussian_filter(rng.random((128, 128)).astype(np.float32), sigma)
        base = (base - base.min()) / max(1e-6, base.max() - base.min())
        for dx, dy in ((3, 0), (0, -2), (4, -3), (7, 5)):
            shifted = warp(base, -np.full(base.shape, float(dx)), -np.full(base.shape, float(dy)))
            u, v = pyramidal_flow(base, shifted)
            eu, ev = float(np.median(u)), float(np.median(v))
            good = abs(eu - dx) < 0.6 and abs(ev - dy) < 0.6
            ok &= good
            print(f"  {'ok  ' if good else 'FAIL'} sigma {sigma:4.1f} translation ({dx:+d},{dy:+d})"
                  f" -> recovered ({eu:+.2f},{ev:+.2f})")
    return ok


# --------------------------------------------------------------------------- #
# sheet helpers
# --------------------------------------------------------------------------- #
def split_cells(img, cols, rows):
    cw, ch = img.shape[1] // cols, img.shape[0] // rows
    return [img[(i // cols) * ch:(i // cols) * ch + ch,
                (i % cols) * cw:(i % cols) * cw + cw] for i in range(cols * rows)], cw, ch


def assemble(frames, cols, rows, cw, ch):
    out = np.zeros((rows * ch, cols * cw, 4), np.float32)
    for i, f in enumerate(frames):
        r, c = divmod(i, cols)
        out[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw] = f
    return out


def to_png(arr, path):
    Image.fromarray(np.clip(arr * 255.0 + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(path, optimize=True)


def signal(f):
    """What the flow tracks: coverage-weighted luminance."""
    lum = 0.299 * f[..., 0] + 0.587 * f[..., 1] + 0.114 * f[..., 2]
    return np.clip(f[..., 3] * (0.35 + 0.65 * lum), 0, 1)


def erosion_gradient(alpha, seed):
    """Per-pixel dissolve order so the shader can burn a frame away organically
    instead of fading it uniformly. Smooth noise biased outward-first."""
    rng = np.random.default_rng(seed)
    n = gaussian_filter(rng.random(alpha.shape).astype(np.float32),
                        max(1.0, alpha.shape[0] / 24.0), mode='wrap')
    n = (n - n.min()) / max(1e-6, n.max() - n.min())
    h, w = alpha.shape
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.sqrt(((yy - h / 2) / (h / 2)) ** 2 + ((xx - w / 2) / (w / 2)) ** 2)
    return np.clip(0.65 * n + 0.35 * np.clip(r, 0, 1), 0, 1)


def grid_for(n):
    """Prefer an EXACT factorisation so no cell is wasted.

    ceil(sqrt(n)) alone gives 6x6 for 32 frames — four dead cells, i.e. 12% of
    the texture paying rent for nothing. Take the smallest divisor >= sqrt(n)
    instead, and only fall back to the ragged grid when n is prime.
    """
    root = int(np.ceil(np.sqrt(n)))
    for c in range(root, n + 1):
        if n % c == 0:
            return c, n // c
    return root, int(np.ceil(n / root))


# --------------------------------------------------------------------------- #
def process(asset, args):
    key = asset['key']
    tune = TUNING.get(key, dict(keep=None, alpha=args.alpha))
    alpha = tune['alpha']
    src = os.path.join(BANK, 'flipbooks', f'{key}.png')
    if not os.path.exists(src):
        print(f'  skip {key} — no baked colour sheet'); return None

    img = np.asarray(Image.open(src).convert('RGBA'), np.float32) / 255.0
    frames, cw, ch = split_cells(img, asset['cols'], asset['rows'])
    full_n = len(frames)

    keep = args.frames or tune['keep'] or full_n
    keep = min(keep, full_n)
    picks = [int(round(i * full_n / keep)) % full_n for i in range(keep)]
    frames = [frames[i] for i in picks]
    n = len(frames)
    cols, rows = grid_for(n)
    looping = key in LOOPING

    sig = [signal(f) for f in frames]
    fwd, bwd, stats = [], [], []
    for i in range(n):
        j = (i + 1) % n if looping else min(i + 1, n - 1)
        if i == j:
            z = np.zeros_like(sig[i]); fwd.append((z, z)); bwd.append((z, z)); continue
        u, v = pyramidal_flow(sig[i], sig[j], alpha, args.iters)
        bu, bv = pyramidal_flow(sig[j], sig[i], alpha, args.iters)
        fwd.append((u, v)); bwd.append((bu, bv))

    # ---- measure against the frames decimation THREW AWAY ----------------- #
    if args.report:
        orig, _, _ = split_cells(img, asset['cols'], asset['rows'])
        for i in range(n):
            a0 = picks[i]
            a1 = picks[(i + 1) % n] if looping else picks[min(i + 1, n - 1)]
            span = (a1 - a0) % full_n if looping else a1 - a0
            if span <= 1: continue
            A, C = signal(orig[a0]), signal(orig[a1])
            (u, v), (bu, bv) = fwd[i], bwd[i]
            for k in range(1, span):
                t = k / span
                B = signal(orig[(a0 + k) % full_n])
                mv = (1 - t) * warp(A, -t * u, -t * v) + t * warp(C, -(1 - t) * bu, -(1 - t) * bv)
                stats.append((float(np.mean((mv - B) ** 2)),
                              float(np.mean(((1 - t) * A + t * C - B) ** 2))))

    # ---- encode ------------------------------------------------------------ #
    mags = np.concatenate([np.abs(np.stack(f)).ravel() for f in fwd + bwd])
    mv_scale = float(np.clip(np.percentile(mags, 99.5), 0.5, max(cw, ch) * 0.5))
    enc = lambda a: np.clip(a / mv_scale * 0.5 + 0.5, 0.0, 1.0)

    mv_frames, pack_frames = [], []
    for i in range(n):
        (u, v), (bu, bv) = fwd[i], bwd[i]
        mv_frames.append(np.stack([enc(u), enc(v), enc(bu), enc(bv)], -1))
        f = frames[i]
        lum = 0.299 * f[..., 0] + 0.587 * f[..., 1] + 0.114 * f[..., 2]
        a = f[..., 3]
        pack_frames.append(np.stack([lum,
                                     np.clip((lum - 0.55) / 0.45, 0, 1) * a,
                                     erosion_gradient(a, 1000 + i),
                                     a], -1))

    mv_path = os.path.join(BANK, 'flipbooks', f'{key}_mv.png')
    pk_path = os.path.join(BANK, 'flipbooks', f'{key}_pack.png')
    to_png(assemble(mv_frames, cols, rows, cw, ch), mv_path)
    to_png(assemble(pack_frames, cols, rows, cw, ch), pk_path)

    res = {'key': key, 'cols': cols, 'rows': rows, 'frames': n, 'cellW': cw, 'cellH': ch,
           'width': cols * cw, 'height': rows * ch,
           'mvScale': round(mv_scale, 4), 'loop': looping, 'alpha': alpha,
           'sourceFrames': full_n, 'keptFrames': n,
           'mv': f'flipbooks/{key}_mv.png', 'pack': f'flipbooks/{key}_pack.png',
           'mvBytes': os.path.getsize(mv_path), 'packBytes': os.path.getsize(pk_path)}
    if stats:
        m = float(np.mean([s[0] for s in stats])); nn = float(np.mean([s[1] for s in stats]))
        res.update(mvMSE=round(m, 6), crossDissolveMSE=round(nn, 6),
                   gain=round(nn / m, 2) if m > 0 else None)
        print(f'  {key:16} {full_n:3}f -> {n:3}f  {cols}x{rows} cell {cw}x{ch}  '
              f'mvScale {mv_scale:5.2f}px  MV {m:.6f} vs cross-dissolve {nn:.6f}  = {res["gain"]}x better')
    else:
        print(f'  {key:16} {full_n:3}f -> {n:3}f  {cols}x{rows} cell {cw}x{ch}  mvScale {mv_scale:5.2f}px')
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only'); ap.add_argument('--frames', type=int)
    ap.add_argument('--alpha', type=float, default=0.3)
    ap.add_argument('--iters', type=int, default=120)
    ap.add_argument('--report', action='store_true')
    ap.add_argument('--self-test', action='store_true')
    args = ap.parse_args()

    print('flow solver self-test (known translations):')
    if not self_test():
        print('\nSELF-TEST FAILED — flow solver is wrong, refusing to bake.'); sys.exit(1)
    if args.self_test:
        print('\nself-test only, done.'); return

    manifest = json.load(open(os.path.join(BANK, 'bank.json')))
    sheets = [a for a in manifest['assets'] if a['kind'] == 'sheet' and (not args.only or a['key'] == args.only)]
    if not sheets:
        print('no matching flipbooks'); sys.exit(1)

    print(f'\nbaking motion vectors + channel packs for {len(sheets)} flipbook(s)')
    out = [r for r in (process(a, args) for a in sheets) if r]

    idx_path = os.path.join(BANK, 'bank.mv.json')
    prev = {}
    if os.path.exists(idx_path) and args.only:
        prev = {e['key']: e for e in json.load(open(idx_path)).get('sheets', [])}
    for r in out: prev[r['key']] = r
    sheets_out = sorted(prev.values(), key=lambda e: e['key'])
    json.dump({'format': 'emberkeep-vfx-mv', 'version': 1,
               'note': ('Motion-vector + channel-packed companions. mv: RG = forward flow (frame i -> next), '
                        'BA = backward flow (next -> i), each (flow_px / mvScale) * 0.5 + 0.5. '
                        'pack: R density, G emissive, B erosion order, A alpha. '
                        'Shader: warp A forward by t, warp B backward by (1-t), then mix by t. '
                        'Frame counts are DECIMATED — motion vectors reconstruct the dropped frames.'),
               'generatedBy': 'scripts/bake-vfx-mv.py', 'sheets': sheets_out},
              open(idx_path, 'w'), indent=2)
    # Mirror the metadata into src/ so the game bundles it instead of fetching
    # the bank manifest at runtime.
    runtime = {'_generated': 'scripts/bake-vfx-mv.py — DO NOT EDIT. Mirrors assets/vfx-bank/bank.mv.json.',
               'base': 'vfx-bank/', 'ramps': 'vfx-bank/ramps.png',
               'sheets': {e['key']: {k: e[k] for k in ('cols', 'rows', 'frames', 'cellW', 'cellH', 'mvScale', 'loop')}
                          for e in sheets_out}}
    json.dump(runtime, open(os.path.join(ROOT, 'src/data/vfx-flipbooks.json'), 'w'), indent=2)

    tot = sum(e['mvBytes'] + e['packBytes'] for e in sheets_out)
    print(f'\nwrote {len(out)} pair(s), {tot / 1048576:.2f}MB -> assets/vfx-bank/bank.mv.json')


if __name__ == '__main__':
    main()
