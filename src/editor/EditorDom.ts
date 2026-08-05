import { editorStore, type EditorTab, type EditorTool, type PositionEntry } from './editorStore';
import type { ImportedAsset } from './assetImport';
import { saveEditorMap } from './asset3dFs';

/**
 * The DOM chrome of the Map Editor — a Blender-style dark panel with a HORIZONTAL
 * navbar (Edit / Assets / Position), a top-centre "Add map" import, a top-right
 * darken + close, a live x/y/z coordinate readout and a JSON export. FontAwesome
 * icons, minimal text. It only reads/writes `editorStore` + a few provider
 * callbacks; the board reacts on its own.
 */

const CSS = `
.me-root{position:fixed;inset:0;z-index:40;display:none;pointer-events:none;font-family:-apple-system,'Segoe UI',sans-serif;color:#e9e4f0}
.me-root.open{display:block}
.me-root button{cursor:pointer;font-family:inherit;border:none}
.me-sidebar{position:absolute;top:0;left:0;bottom:0;width:236px;background:#17131f;border-right:1px solid #2c2438;
  display:flex;flex-direction:column;pointer-events:auto;box-shadow:2px 0 18px #0008}
/* HORIZONTAL navbar (flex row) */
.me-nav{display:flex;flex-direction:row;gap:4px;padding:8px;border-bottom:1px solid #2c2438}
.me-nav .me-tab{flex:1;height:42px;border-radius:10px;background:#241c31;color:#b9b0c9;font-size:16px;
  display:flex;align-items:center;justify-content:center;gap:6px;transition:all .12s}
.me-nav .me-tab:hover{background:#31263f;color:#fff}
.me-nav .me-tab.active{background:#fff;color:#17131f;box-shadow:0 0 0 2px #ffd84d}
.me-body{flex:1;overflow:auto;padding:12px}
.me-panel{display:none;flex-direction:column;gap:10px}
.me-panel.show{display:flex}
.me-tools{display:flex;flex-wrap:wrap;gap:8px}
.me-lvl{display:flex;align-items:center;gap:8px;font-size:12px;color:#cfc6dd}
.me-lvl i{color:#8fd0ff}
.me-lvl input{width:54px;height:32px;border-radius:8px;background:#241c31;color:#ffd84d;border:1px solid #3a2e4c;text-align:center;font:700 15px/1 sans-serif}
.me-btn{width:48px;height:48px;border-radius:12px;background:#241c31;color:#b9b0c9;font-size:19px;
  display:flex;align-items:center;justify-content:center;transition:all .12s}
.me-btn:hover{background:#31263f;color:#fff}
.me-btn.active{background:#fff;color:#17131f;box-shadow:0 0 0 2px #ffd84d}
.me-btn.accent{background:#d9821f;color:#fff}.me-btn.accent:hover{background:#f5a01e}
.me-wide{width:100%;height:40px;border-radius:10px;background:#241c31;color:#cfc6dd;font-size:14px;
  display:flex;align-items:center;justify-content:center;gap:8px}
.me-wide:hover{background:#31263f;color:#fff}
.me-wide.accent{background:#d9821f;color:#fff}.me-wide.accent:hover{background:#f5a01e}
.me-fmt{display:none;gap:6px}.me-fmt.show{display:flex}
.me-fmt button{flex:1;height:34px;border-radius:8px;background:#2b2238;color:#e9e4f0;font-size:13px;font-weight:700}
.me-fmt button:hover{background:#3a2e4c}
.me-preview{display:none;align-items:center;gap:10px;background:#0d0a14;border:1px solid #ffd84d;border-radius:10px;padding:8px}
.me-preview.show{display:flex}
.me-movable{display:none;gap:6px}.me-movable.show{display:flex}
.me-movable button{flex:1;height:36px;border-radius:8px;background:#241c31;color:#b9b0c9;font-size:13px;font-weight:700;border:1px solid #3a2e4c}
.me-movable button:hover{background:#2c2138}
.me-movable button.active{background:#d9821f;color:#fff;border-color:#d9821f}
.me-preview img{width:52px;height:52px;object-fit:contain}
.me-preview span{font-size:12px;color:#cfc6dd;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.me-xform{display:none;flex-direction:column;gap:8px;background:#0d0a14;border:1px solid #2c2438;border-radius:10px;padding:8px}
.me-xform.show{display:flex}
.me-xrow{display:flex;align-items:center;gap:6px}
.me-xrow i{color:#b9b0c9}
.me-xlab{color:#8fd0ff;font:700 12px/1 sans-serif;width:12px}
.me-xrow input[type=number]{width:100%;min-width:0;height:30px;border-radius:7px;background:#241c31;color:#ffd84d;border:1px solid #3a2e4c;text-align:center;font:700 13px/1 sans-serif}
.me-xrow input[type=range]{flex:1;accent-color:#ffd84d}
.me-rot-num{flex:0 0 auto;width:56px!important}
.me-fliprow button{flex:1;height:32px;border-radius:7px;background:#241c31;color:#cfc6dd;font-size:13px;font-weight:700;border:1px solid #3a2e4c}
.me-fliprow button:hover{background:#2c2138}
.me-fliprow button.active{background:#d9821f;color:#fff;border-color:#d9821f}
.me-list{display:flex;flex-direction:column;gap:4px}
.me-row{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:8px;background:#201829;font-size:12px}
.me-row:hover{background:#2c2138}.me-row.sel{background:#fff;color:#17131f}
.me-row .nm{flex:1;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.me-row .co{font-family:'SFMono-Regular',Consolas,monospace;color:#ffd84d}.me-row.sel .co{color:#b5602f}
.me-row .rk{background:#3a2e4c;color:#ffd84d;border-radius:6px;padding:1px 6px;font-weight:700}.me-row.sel .rk{background:#f0e2c8;color:#b5602f}
.me-row .del{width:26px;height:26px;border-radius:6px;background:#3a2233;color:#e88;font-size:13px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.me-row .del:hover{background:#7a2436;color:#fff}.me-row.sel .del{background:#e7cbc0;color:#a33}
.me-empty{color:#7f76a0;font-size:12px;text-align:center;padding:18px 0}
.me-legend{display:flex;flex-direction:column;gap:5px;margin-top:6px;padding-top:8px;border-top:1px solid #2c2438;font-size:11px;color:#b9b0c9}
.me-legend .lg{display:flex;align-items:center;gap:7px}
.me-legend .sw{width:13px;height:13px;border-radius:4px;flex:0 0 auto;box-shadow:0 0 0 1px #0006}
.me-coords{padding:10px 12px;border-top:1px solid #2c2438;display:flex;gap:14px;justify-content:center;
  font:700 13px/1 'SFMono-Regular',Consolas,monospace}
.me-coords .k{color:#7f76a0}.me-coords .v{color:#ffd84d}
.me-top{position:absolute;top:12px;left:0;right:0;display:flex;justify-content:center;gap:10px;pointer-events:none}
.me-addmap{pointer-events:auto;height:44px;padding:0 18px;border-radius:22px;background:#241c31d9;color:#fff;font-size:14px;
  display:flex;align-items:center;gap:8px;backdrop-filter:blur(4px);box-shadow:0 4px 14px #0006}
.me-addmap:hover{background:#31263f}
.me-pager{pointer-events:auto;height:44px;padding:0 6px;border-radius:22px;background:#241c31d9;color:#fff;
  display:none;align-items:center;gap:4px;backdrop-filter:blur(4px);box-shadow:0 4px 14px #0006}
.me-pager.show{display:flex}
.me-pager button{width:34px;height:34px;border-radius:50%;background:transparent;color:#cfc6dd;font-size:16px;
  display:flex;align-items:center;justify-content:center}
.me-pager button:hover{background:#3a2e4c;color:#fff}
.me-pager .pg{min-width:74px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
.me-pager .pg .lvl{font:800 14px/1 -apple-system,'Segoe UI',sans-serif;color:#ffd84d;white-space:nowrap}
.me-pager .pg .cnt{font:700 10px/1 'SFMono-Regular',Consolas,monospace;color:#8f86a8}
.me-tr{position:absolute;top:12px;right:14px;display:flex;gap:8px;pointer-events:auto}
.me-tr .me-btn{width:44px;height:44px;background:#241c31d9;backdrop-filter:blur(4px)}
.me-tr .me-btn.active{background:#fff;color:#17131f}
.me-mapfmt{position:absolute;top:64px;left:50%;transform:translateX(-50%);display:none;gap:8px;pointer-events:auto}
.me-mapfmt.show{display:flex}
.me-mapfmt button{height:38px;padding:0 16px;border-radius:10px;background:#241c31;color:#fff;font-size:13px;font-weight:700}
.me-mapfmt button:hover{background:#31263f}
.me-objpanel{position:absolute;top:66px;right:14px;width:270px;max-height:74vh;overflow:auto;pointer-events:auto;
  background:#17131f;border:1px solid #2c2438;border-radius:12px;padding:10px;box-shadow:0 8px 22px #0009;display:none}
.me-objpanel.show{display:block}
.me-delmap{position:absolute;bottom:16px;right:16px;pointer-events:auto;height:46px;padding:0 18px;border-radius:23px;
  background:#3a2233d9;color:#f0a0a0;font-size:14px;display:none;align-items:center;gap:8px;backdrop-filter:blur(4px);box-shadow:0 4px 14px #0007}
.me-delmap.show{display:flex}
.me-delmap:hover{background:#7a2436;color:#fff}
.me-objpanel .me-title{font-size:12px;font-weight:700;color:#b9b0c9;margin:0 2px 8px;display:flex;justify-content:space-between}
.me-hint{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);pointer-events:none;
  background:#17131fcc;color:#cfc6dd;font-size:12px;padding:6px 12px;border-radius:20px;border:1px solid #2c2438;max-width:60vw;text-align:center}
.me-trace.active{background:#2ad673;color:#08281a;box-shadow:0 0 0 2px #8af3ff}
.me-finish{display:none;background:#2ad673;color:#08281a;font-weight:800}
.me-finish:hover{background:#3fe08a;color:#062018}
.me-finish.show{display:flex}
.me-tracehint{display:none;font-size:11px;color:#ffd84d;background:#2a2410;border:1px solid #5a4a12;border-radius:8px;padding:7px 9px;line-height:1.5}
.me-tracehint.show{display:block}
.me-gridhint{display:none;font-size:11px;color:#ff9cf0;background:#2a1030;border:1px solid #6a1a5e;border-radius:8px;padding:7px 9px;line-height:1.5}
.me-gridhint.show{display:block}
.me-delgrid{display:none}.me-delgrid.show{display:flex}
.me-addgrid:disabled{opacity:.4;cursor:not-allowed}
.me-row .zname{flex:1;min-width:0;background:transparent;border:none;color:inherit;font:700 12px/1 inherit;padding:3px 4px;border-radius:4px}
.me-row .zname:focus{outline:none;background:#0d0a14;color:#ffd84d}
.me-row.sel .zname{color:#17131f}.me-row.sel .zname:focus{color:#ffd84d}
.me-grillehint{font-size:11px;color:#9fe0c0;background:#0d1f18;border:1px solid #1c4a38;border-radius:8px;padding:7px 9px;line-height:1.5}
.me-griddrawhint{display:none;font-size:11px;color:#ffd84d;background:#2a2410;border:1px solid #5a4a12;border-radius:8px;padding:7px 9px;line-height:1.5}
.me-griddrawhint.show{display:block}
.me-gcap{font:700 10px/1 sans-serif;color:#8fd0ff;text-transform:uppercase;letter-spacing:.05em;margin-top:3px}
.me-grow{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:#cfc6dd}
.me-gpersp,.me-zonegrid{flex:1;height:30px;border-radius:7px;background:#241c31;color:#ffd84d;border:1px solid #3a2e4c;font:700 12px/1 sans-serif;padding:0 6px}
.me-zonegridrow{display:none}.me-zonegridrow.show{display:flex}
.me-missing{position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;background:#0009;pointer-events:auto}
.me-missing.show{display:flex}
.me-missing-box{width:min(560px,86vw);max-height:76vh;overflow:auto;background:#17131f;border:1px solid #ffd84d;border-radius:14px;padding:18px;box-shadow:0 12px 40px #000a}
.me-missing-title{font-size:17px;font-weight:800;color:#ffd84d;margin-bottom:6px}
.me-missing-sub{font-size:12px;color:#cfc6dd;line-height:1.6;margin-bottom:10px}
.me-missing-list{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.me-missing-list .f{font-family:'SFMono-Regular',Consolas,monospace;font-size:13px;color:#ffd27a;background:#0d0a14;border:1px solid #3a2e4c;border-radius:7px;padding:7px 10px}
.me-missing-close{width:100%;height:42px;border-radius:10px;background:#d9821f;color:#fff;font-size:14px;font-weight:700}
.me-missing-close:hover{background:#f5a01e}
`;

export class EditorDom {
  private root: HTMLDivElement;
  private fileInput: HTMLInputElement;
  private importRole: 'asset' | 'map' | 'json' = 'asset';
  private off: () => void;
  private onKey: (e: KeyboardEvent) => void; // zone shortcuts: Enter/Esc/⌫ while drawing
  previewProvider: ((key: string) => string | null) | null = null;

  private viewAssets = false;
  private viewObjects = false;

  constructor(
    private onImport: (file: File) => Promise<ImportedAsset>,
    private onExport: () => void,
    private listObjects: () => PositionEntry[],
    private onFocus: (id: string) => void,
    private onClose: () => void,
    private onApply: () => void,
    private onSave: () => void,
    private onViewObjects: (show: boolean) => void,
    private onDeleteAsset: (id: string) => void,
    private onImportJson: (data: unknown) => Promise<{ imported: boolean; missing: string[]; error?: string }>
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'me-root';
    this.root.innerHTML = this.markup();
    document.body.appendChild(this.root);
    this.fileInput = this.root.querySelector('.me-file')!;
    this.wire();
    // Zone keyboard shortcuts (document-level so canvas focus never swallows them):
    // Enter = finish+name, Esc = cancel, Backspace = undo last point — only while
    // the "Tracer une zone" tool is live.
    this.onKey = (e: KeyboardEvent): void => {
      if (!editorStore.open) return;
      if (editorStore.drawingGrid) {
        if (e.key === 'Escape') {
          e.preventDefault();
          editorStore.cancelGridDraw();
        }
        return;
      }
      if (editorStore.calibratingGrid) {
        if (e.key === 'Escape') {
          e.preventDefault();
          editorStore.cancelGridCalibration();
        } else if (e.key === 'Backspace') {
          e.preventDefault();
          editorStore.undoCalibPoint();
        }
        return;
      }
      if (!editorStore.drawingZone) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this.finishZone();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        editorStore.cancelZoneDraw();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        editorStore.undoZonePoint();
      }
    };
    document.addEventListener('keydown', this.onKey);
    this.off = editorStore.on('change', () => this.render());
    this.render();
  }

  /** Close the current zone draft (shared by the "Terminer" button AND the Enter
   *  key), add it to the list, and focus its name field for immediate inline
   *  naming — no blocking prompt (that was swallowed by keyboard focus in Firefox). */
  private finishZone(): void {
    if (!editorStore.drawingZone) return;
    if (editorStore.draftPoints.length < 3) {
      this.setHint('Place au moins 3 points, puis Entrée');
      return;
    }
    const z = editorStore.finishZone(); // auto-name "Zone N"; renamed inline below
    if (!z) return;
    this.setHint('Zone créée — tape son nom, puis « Ajouter une grille »');
    requestAnimationFrame(() => {
      const inp = this.root.querySelector<HTMLInputElement>(`.me-zone-list .zname[data-id="${z.id}"]`);
      if (inp) {
        inp.focus();
        inp.select();
      }
    });
  }

  private markup(): string {
    return `
    <aside class="me-sidebar">
      <nav class="me-nav">
        <button class="me-tab" data-tab="edit" title="Edit grid"><i class="fa-solid fa-pen-ruler"></i></button>
        <button class="me-tab" data-tab="assets" title="Assets"><i class="fa-solid fa-cube"></i></button>
        <button class="me-tab" data-tab="position" title="Positions"><i class="fa-solid fa-location-crosshairs"></i></button>
        <button class="me-tab" data-tab="grille" title="Grille — définir la grille (perspective, taille, matrice)"><i class="fa-solid fa-border-all"></i></button>
        <button class="me-tab" data-tab="carte" title="Carte — dessiner des zones"><i class="fa-solid fa-map-location-dot"></i></button>
      </nav>
      <div class="me-body">
        <div class="me-panel me-edit">
          <div class="me-tools">
            <button class="me-btn me-tool" data-tool="select" title="Select grid"><i class="fa-solid fa-arrow-pointer"></i></button>
            <button class="me-btn me-tool" data-tool="multiselect" title="Multi-select (Ctrl+click removes)"><i class="fa-solid fa-object-group"></i></button>
            <button class="me-btn me-tool" data-tool="allocate" title="Allocate"><i class="fa-solid fa-square-plus"></i></button>
            <button class="me-btn me-tool" data-tool="deallocate" title="De-allocate"><i class="fa-solid fa-square-minus"></i></button>
          </div>
          <div class="me-lvl" title="Niveau où les cases allouées s'ouvrent (1 = tout de suite)">
            <i class="fa-solid fa-layer-group"></i><span>Ouvre au niveau</span>
            <input class="me-lvlinput" type="number" min="1" max="9" value="1"/>
          </div>
          <button class="me-wide me-all" title="Select whole map"><i class="fa-solid fa-border-all"></i></button>
          <div class="me-tools">
            <button class="me-btn me-save" title="Save"><i class="fa-solid fa-floppy-disk"></i></button>
            <button class="me-btn accent me-apply" title="Apply to game (make cells habitable + show assets)"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
            <button class="me-btn me-export" title="Export emberkeep-map.json (re-importable)"><i class="fa-solid fa-file-export"></i></button>
            <button class="me-btn me-import" title="Import a JSON — restores grids/zones/assets/maps"><i class="fa-solid fa-file-import"></i></button>
          </div>
          <div class="me-legend">
            <div class="lg"><span class="sw" style="background:#2ad673"></span>Jouable (active)</div>
            <div class="lg"><span class="sw" style="background:#2ad673;box-shadow:0 0 0 2px #3fe0ff"></span>Alloué par toi → Apply</div>
            <div class="lg"><span class="sw" style="background:#f5a01e"></span>Se débloque (Lv / 🔑)</div>
            <div class="lg"><span class="sw" style="background:#7a2436"></span>Verrouillé</div>
          </div>
        </div>

        <div class="me-panel me-assets">
          <button class="me-wide accent me-add" title="Add asset"><i class="fa-solid fa-plus"></i></button>
          <div class="me-fmt">
            <button data-fmt=".png,.jpg,.webp">PNG</button>
            <button data-fmt=".glb,.gltf">GLB</button>
            <button data-fmt=".obj">OBJ</button>
            <button data-fmt=".fbx">FBX</button>
          </div>
          <div class="me-preview"><img alt=""/><span></span></div>
          <div class="me-movable">
            <button data-mv="0" title="Décor fixe — le joueur ne peut PAS le déplacer (éditeur seulement)">🔒 Fixe</button>
            <button data-mv="1" title="Modifiable — le joueur peut le déplacer en jeu">✋ Modifiable</button>
          </div>
          <div class="me-xform">
            <div class="me-xrow">
              <span class="me-xlab">x</span><input class="me-x" type="number" step="1"/>
              <span class="me-xlab">y</span><input class="me-y" type="number" step="1"/>
              <span class="me-xlab">z</span><input class="me-z" type="number" step="4"/>
            </div>
            <div class="me-xrow"><i class="fa-solid fa-up-right-and-down-left-from-center"></i><input class="me-size-input" type="range" min="0.2" max="5" step="0.05"/></div>
            <div class="me-xrow"><i class="fa-solid fa-rotate"></i><input class="me-rot-input" type="range" min="0" max="360" step="1"/><input class="me-rot-num" type="number" min="0" max="360" step="5"/></div>
            <div class="me-xrow me-fliprow"><i class="fa-solid fa-arrows-left-right"></i><button class="me-flipx" title="Miroir horizontal (changer la face)">⇋ Face</button><button class="me-flipy" title="Miroir vertical">⇅ Flip</button></div>
          </div>
          <button class="me-wide me-view" title="View assets in this map"><i class="fa-solid fa-eye"></i></button>
          <div class="me-list me-asset-list"></div>
        </div>

        <div class="me-panel me-position">
          <div class="me-list"></div>
        </div>

        <div class="me-panel me-grille">
          <button class="me-wide accent me-newgrid" title="Dessiner une nouvelle grille (glisser un rectangle)"><i class="fa-solid fa-plus"></i> Nouvelle grille</button>
          <div class="me-griddrawhint">Glisse un <b>rectangle</b> sur le plateau pour poser la grille · <b>Échap</b> annule. Ensuite : règle la matrice C×R, la perspective, la taille.</div>
          <div class="me-grillehint">Les grilles se créent <b>à la main</b>. Une fois posée : glisse le corps (ou le bouton <b>vert</b>) pour <b>déplacer</b>, le carré du coin pour <b>retailler</b>, la poignée du haut pour <b>tourner</b> — les 3 boutons marchent depuis <b>n'importe quel onglet</b> tant que la grille est sélectionnée. Marque les cases jouables dans <b>Edit</b>. Les assets (onglet Assets) s'aimantent sur ses cases.</div>
          <div class="me-list me-grid-list"></div>
          <div class="me-xform me-gridform" title="Réglage de la grille sélectionnée">
            <div class="me-grow"><span>Perspective</span>
              <select class="me-gpersp">
                <option value="iso">Isométrique</option>
                <option value="ortho">Orthogonale</option>
              </select>
            </div>
            <div class="me-gcap">Matrice (cases)</div>
            <div class="me-xrow"><span class="me-xlab">C</span><input class="me-gcols" type="number" step="1" min="1"/><span class="me-xlab">R</span><input class="me-grows" type="number" step="1" min="1"/></div>
            <div class="me-gcap">Taille (px)</div>
            <div class="me-xrow"><span class="me-xlab">L</span><input class="me-gw" type="number" step="1" min="16"/><span class="me-xlab">H</span><input class="me-gh" type="number" step="1" min="16"/></div>
            <div class="me-gcap">Position</div>
            <div class="me-xrow"><span class="me-xlab">X</span><input class="me-gox" type="number" step="1"/><span class="me-xlab">Y</span><input class="me-goy" type="number" step="1"/></div>
            <div class="me-gcap">Rotation (°)</div>
            <div class="me-xrow"><span class="me-xlab"><i class="fa-solid fa-rotate"></i></span><input class="me-grot" type="number" step="1"/></div>
          </div>
          <button class="me-wide me-cleargrids" title="Supprimer toutes les grilles"><i class="fa-solid fa-trash"></i> Tout supprimer</button>
        </div>

        <div class="me-panel me-carte">
          <div class="me-grow me-zonegridrow" title="La grille sur laquelle la zone se cale (aimantage aux tuiles)">
            <span><i class="fa-solid fa-border-all"></i> Grille</span>
            <select class="me-zonegrid"></select>
          </div>
          <button class="me-wide accent me-trace" title="Tracer une zone (polygone)"><i class="fa-solid fa-draw-polygon"></i> Tracer une zone</button>
          <button class="me-wide me-finish" title="Terminer et nommer la zone"><i class="fa-solid fa-check"></i> Terminer la zone</button>
          <div class="me-tracehint">Clic = poser un point · <b>Entrée</b> ou <b>Terminer</b> = nommer &amp; enregistrer · Échap = annuler · ⌫ = dernier point</div>
          <div class="me-list me-zone-list"></div>
          <div class="me-xform me-zoneform" title="Réglage précis de la zone sélectionnée">
            <div class="me-xrow"><span class="me-xlab">X</span><input class="me-zx" type="number" step="1"/><span class="me-xlab">Y</span><input class="me-zy" type="number" step="1"/></div>
            <div class="me-xrow"><span class="me-xlab">L</span><input class="me-zw" type="number" step="1"/><span class="me-xlab">H</span><input class="me-zh" type="number" step="1"/></div>
          </div>
          <button class="me-wide me-addgrid" title="Ajouter une grille calée sur les tuiles du dessin"><i class="fa-solid fa-table-cells"></i> Ajouter une grille</button>
          <div class="me-gridhint">Clique les 4 coins d'une tuile : <b>haut, droite, bas, gauche</b> (<span class="gc">0</span>/4) · Échap annule</div>
          <button class="me-wide me-delgrid" title="Retirer la grille de cette zone"><i class="fa-solid fa-eraser"></i> Retirer la grille</button>
          <button class="me-wide me-clearzones" title="Supprimer toutes les zones"><i class="fa-solid fa-trash"></i> Tout supprimer</button>
          <button class="me-wide me-gridtoggle" title="Afficher / masquer la grille carrée globale"><i class="fa-solid fa-border-none"></i> <span class="gt-label">Grille carrée : afficher</span></button>
        </div>
      </div>
      <div class="me-coords">
        <span><span class="k">x</span> <span class="v vx">--</span></span>
        <span><span class="k">y</span> <span class="v vy">--</span></span>
        <span><span class="k">z</span> <span class="v vz">--</span></span>
      </div>
    </aside>

    <div class="me-top">
      <div class="me-pager">
        <button class="me-prev" title="Previous level"><i class="fa-solid fa-chevron-left"></i></button>
        <span class="pg"><span class="lvl">Level 1</span><span class="cnt">1/1</span></span>
        <button class="me-next" title="Next level"><i class="fa-solid fa-chevron-right"></i></button>
      </div>
      <button class="me-addmap" title="Import a map (2D PNG / 3D OBJ,FBX)"><i class="fa-solid fa-map"></i> <i class="fa-solid fa-plus"></i></button>
    </div>
    <div class="me-mapfmt">
      <button data-mapfmt=".png,.jpg,.webp">2D · PNG</button>
      <button data-mapfmt=".glb,.gltf,.obj,.fbx">3D · GLB/OBJ/FBX</button>
    </div>
    <div class="me-tr">
      <button class="me-btn me-objects" title="View all game objects (dragons, house…)"><i class="fa-solid fa-eye"></i></button>
      <button class="me-btn me-blackout" title="Fond noir — effacer le fond par défaut (écran noir)"><i class="fa-solid fa-square"></i></button>
      <button class="me-btn me-darken" title="Darken map"><i class="fa-solid fa-moon"></i></button>
      <button class="me-btn me-close" title="Close editor"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="me-objpanel">
      <div class="me-title"><span>Objects in game</span></div>
      <div class="me-list me-obj-list"></div>
    </div>
    <button class="me-delmap" title="Delete this map"><i class="fa-solid fa-trash-can"></i> <i class="fa-solid fa-map"></i></button>
    <input type="file" class="me-file" style="display:none"/>
    <div class="me-missing">
      <div class="me-missing-box">
        <div class="me-missing-title"></div>
        <div class="me-missing-sub"></div>
        <div class="me-missing-list"></div>
        <button class="me-missing-close"><i class="fa-solid fa-check"></i> OK</button>
      </div>
    </div>
    <div class="me-hint"></div>`;
  }

  private q<T extends Element>(s: string): T {
    return this.root.querySelector<T>(s)!;
  }

  private wire(): void {
    this.root.querySelectorAll<HTMLButtonElement>('.me-tab').forEach((b) =>
      b.addEventListener('click', () => editorStore.setTab(b.dataset.tab as EditorTab))
    );
    this.root.querySelectorAll<HTMLButtonElement>('.me-tool').forEach((b) =>
      b.addEventListener('click', () => editorStore.setTool(b.dataset.tool as EditorTool))
    );
    this.q<HTMLButtonElement>('.me-all').addEventListener('click', () => editorStore.selectAll());
    this.q<HTMLInputElement>('.me-lvlinput').addEventListener('input', (e) =>
      editorStore.setAllocLevel(Number((e.target as HTMLInputElement).value))
    );
    this.q<HTMLButtonElement>('.me-export').addEventListener('click', () => this.onExport());
    this.q<HTMLButtonElement>('.me-import').addEventListener('click', () => this.pickFile('.json,application/json', 'json'));
    this.q<HTMLButtonElement>('.me-missing-close').addEventListener('click', () =>
      this.q('.me-missing').classList.remove('show')
    );
    this.q<HTMLButtonElement>('.me-save').addEventListener('click', () => {
      this.onSave();
      this.setHint('Saved & applied to game');
    });
    this.q<HTMLButtonElement>('.me-apply').addEventListener('click', () => {
      this.onApply();
      this.setHint('Applied to game');
    });
    this.q<HTMLButtonElement>('.me-view').addEventListener('click', () => {
      this.viewAssets = !this.viewAssets;
      this.render();
    });
    this.q<HTMLButtonElement>('.me-objects').addEventListener('click', () => {
      this.viewObjects = !this.viewObjects;
      this.onViewObjects(this.viewObjects); // reveal/hide the actual objects on the map
      this.render();
    });
    this.q<HTMLButtonElement>('.me-delmap').addEventListener('click', () => editorStore.removeCurrentMap());
    this.q<HTMLButtonElement>('.me-blackout').addEventListener('click', () => editorStore.setBlackout(!editorStore.blackout));
    this.q<HTMLButtonElement>('.me-darken').addEventListener('click', () => editorStore.setDarken(!editorStore.darken));
    this.q<HTMLButtonElement>('.me-close').addEventListener('click', () => this.onClose());
    this.q<HTMLButtonElement>('.me-prev').addEventListener('click', () => editorStore.prevMap());
    this.q<HTMLButtonElement>('.me-next').addEventListener('click', () => editorStore.nextMap());

    // Carte tab: draw zones + grid toggle + clear.
    this.q<HTMLButtonElement>('.me-trace').addEventListener('click', () => {
      if (editorStore.drawingZone) editorStore.cancelZoneDraw();
      else editorStore.startZoneDraw();
    });
    this.q<HTMLButtonElement>('.me-finish').addEventListener('click', () => this.finishZone());
    this.q<HTMLButtonElement>('.me-addgrid').addEventListener('click', () => {
      if (editorStore.calibratingGrid) editorStore.cancelGridCalibration();
      else if (editorStore.selectedZone) editorStore.startGridCalibration();
      else this.setHint('Sélectionne d’abord une zone dans la liste');
    });
    this.q<HTMLButtonElement>('.me-delgrid').addEventListener('click', () => {
      if (editorStore.selectedZoneId) editorStore.removeZoneGrid(editorStore.selectedZoneId);
    });
    this.q<HTMLButtonElement>('.me-gridtoggle').addEventListener('click', () => editorStore.setShowGrid(!editorStore.showGrid));
    this.q<HTMLButtonElement>('.me-clearzones').addEventListener('click', () => editorStore.clearZones());
    // Which grid the next zone snaps to (empty = free-hand).
    this.q<HTMLSelectElement>('.me-zonegrid').addEventListener('change', (e) =>
      editorStore.selectGrid((e.target as HTMLSelectElement).value || null)
    );
    // Precise zone edit: X/Y (bbox top-left) + L/H (bbox size).
    const bindZone = (sel: string, key: 'x' | 'y' | 'w' | 'h') =>
      this.q<HTMLInputElement>(sel).addEventListener('input', (e) => {
        const z = editorStore.selectedZone;
        const v = Math.round(Number((e.target as HTMLInputElement).value));
        if (z && Number.isFinite(v)) editorStore.setZoneBounds(z.id, { [key]: v });
      });
    bindZone('.me-zx', 'x');
    bindZone('.me-zy', 'y');
    bindZone('.me-zw', 'w');
    bindZone('.me-zh', 'h');

    // Grille tab: DRAW a new grid (drag a box) / clear + the param form.
    // Perspective + matrix go through setGridParams; box size/position through
    // setGridBounds (tile size is derived — the box fills with cols×rows cells).
    this.q<HTMLButtonElement>('.me-newgrid').addEventListener('click', () => {
      if (editorStore.drawingGrid) editorStore.cancelGridDraw();
      else editorStore.startGridDraw();
    });
    this.q<HTMLButtonElement>('.me-cleargrids').addEventListener('click', () => editorStore.clearGrids());
    this.q<HTMLSelectElement>('.me-gpersp').addEventListener('change', (e) => {
      const g = editorStore.selectedGrid;
      const v = (e.target as HTMLSelectElement).value;
      if (g && (v === 'iso' || v === 'ortho')) editorStore.setGridParams(g.id, { persp: v });
    });
    const bindMatrix = (sel: string, key: 'cols' | 'rows') =>
      this.q<HTMLInputElement>(sel).addEventListener('input', (e) => {
        const g = editorStore.selectedGrid;
        const v = Number((e.target as HTMLInputElement).value);
        if (g && Number.isFinite(v)) editorStore.setGridParams(g.id, { [key]: v });
      });
    bindMatrix('.me-gcols', 'cols');
    bindMatrix('.me-grows', 'rows');
    const bindBox = (sel: string, key: 'x' | 'y' | 'w' | 'h') =>
      this.q<HTMLInputElement>(sel).addEventListener('input', (e) => {
        const g = editorStore.selectedGrid;
        const v = Math.round(Number((e.target as HTMLInputElement).value));
        if (g && Number.isFinite(v)) editorStore.setGridBounds(g.id, { [key]: v });
      });
    bindBox('.me-gw', 'w');
    bindBox('.me-gh', 'h');
    bindBox('.me-gox', 'x');
    bindBox('.me-goy', 'y');
    this.q<HTMLInputElement>('.me-grot').addEventListener('input', (e) => {
      const g = editorStore.selectedGrid;
      const v = Number((e.target as HTMLInputElement).value);
      if (g && Number.isFinite(v)) editorStore.setGridRot(g.id, v);
    });

    // Add ASSET → format chooser → file dialog (role 'asset').
    this.q<HTMLButtonElement>('.me-add').addEventListener('click', () => this.q('.me-fmt').classList.toggle('show'));
    this.root.querySelectorAll<HTMLButtonElement>('.me-fmt button').forEach((b) =>
      b.addEventListener('click', () => this.pickFile(b.dataset.fmt!, 'asset'))
    );
    // Add MAP (top-centre) → 2D/3D chooser → file dialog (role 'map').
    this.q<HTMLButtonElement>('.me-addmap').addEventListener('click', () => this.q('.me-mapfmt').classList.toggle('show'));
    this.root.querySelectorAll<HTMLButtonElement>('.me-mapfmt button').forEach((b) =>
      b.addEventListener('click', () => this.pickFile(b.dataset.mapfmt!, 'map'))
    );

    this.fileInput.addEventListener('change', () => void this.onFile());
    this.q<HTMLInputElement>('.me-size-input').addEventListener('input', (e) => {
      const sel = editorStore.selectedAsset;
      if (sel) editorStore.scaleAsset(sel.id, Number((e.target as HTMLInputElement).value));
    });
    const onRot = (e: Event) => {
      const sel = editorStore.selectedAsset;
      if (sel) editorStore.setAssetPos(sel.id, { rot: Math.round(Number((e.target as HTMLInputElement).value)) });
    };
    this.q<HTMLInputElement>('.me-rot-input').addEventListener('input', onRot); // the slider
    this.q<HTMLInputElement>('.me-rot-num').addEventListener('input', onRot); // the exact degrees box
    this.q<HTMLButtonElement>('.me-flipx').addEventListener('click', () => {
      const sel = editorStore.selectedAsset;
      if (sel) editorStore.toggleAssetFlip(sel.id, 'x');
    });
    this.q<HTMLButtonElement>('.me-flipy').addEventListener('click', () => {
      const sel = editorStore.selectedAsset;
      if (sel) editorStore.toggleAssetFlip(sel.id, 'y');
    });
    const posInput = (sel: HTMLInputElement, axis: 'col' | 'row' | 'z') =>
      sel.addEventListener('input', (e) => {
        const a = editorStore.selectedAsset;
        if (a) editorStore.setAssetPos(a.id, { [axis]: Math.round(Number((e.target as HTMLInputElement).value)) });
      });
    posInput(this.q<HTMLInputElement>('.me-x'), 'col');
    posInput(this.q<HTMLInputElement>('.me-y'), 'row');
    posInput(this.q<HTMLInputElement>('.me-z'), 'z');

    // Fixe ↔ Modifiable: a selected asset flips its own flag; otherwise it pre-sets
    // the pending (about-to-be-placed) asset so it lands with that choice.
    this.root.querySelectorAll<HTMLButtonElement>('.me-movable button').forEach((b) =>
      b.addEventListener('click', () => {
        const movable = b.dataset.mv === '1';
        const sel = editorStore.selectedAsset;
        if (sel) editorStore.setAssetMovable(sel.id, movable);
        else if (editorStore.pendingAsset) editorStore.setPendingMovable(movable);
      })
    );
  }

  private pickFile(accept: string, role: 'asset' | 'map' | 'json'): void {
    this.importRole = role;
    this.fileInput.accept = accept;
    this.fileInput.value = '';
    this.fileInput.click();
    this.q('.me-fmt').classList.remove('show');
    this.q('.me-mapfmt').classList.remove('show');
  }

  private async onFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    if (!file) return;
    // JSON import: restore the whole project (grids/zones/assets/maps) from the file.
    if (this.importRole === 'json') {
      this.setHint('Importing JSON…');
      try {
        const data = JSON.parse(await file.text());
        const res = await this.onImportJson(data);
        if (!res.imported) {
          this.setHint('Import failed: ' + (res.error ?? 'bad JSON'));
        } else if (res.missing.length) {
          this.setHint(`Imported — ${res.missing.length} asset file(s) missing`);
          this.showMissing(res.missing);
        } else {
          this.setHint('Imported ✓ — grids, zones & assets restored');
        }
      } catch (e) {
        this.setHint('Import failed: ' + (e as Error).message);
      }
      return;
    }
    this.setHint(this.importRole === 'map' ? 'Optimising map…' : 'Baking asset…');
    try {
      const a = await this.onImport(file);
      if (this.importRole === 'map') {
        // Add-map (top-centre): drops straight in as a paged base layer — no
        // click-to-place. The store saves it (data-URL) so it survives a reload.
        editorStore.addMap({
          id: `m${Date.now()}`,
          name: a.name,
          kind: a.kind,
          textureKey: a.textureKey,
          w: a.w,
          h: a.h,
          dataUrl: a.dataUrl
        });
        void saveEditorMap(editorStore.serializeProject()); // bake the new map to disk now
        this.setHint(`Map “${a.name}” added`);
      } else {
        editorStore.setPendingAsset({
          id: `a${Date.now()}`,
          name: a.name,
          kind: a.kind,
          role: 'asset',
          textureKey: a.textureKey,
          w: a.w,
          h: a.h,
          scale: 1,
          fileName: a.fileName, // original filename (manifest key — "home.png")
          dataUrl: a.dataUrl,
          modelSrc: a.modelSrc, // 3D source (only when no disk store) so it persists + animates
          modelExt: a.modelExt,
          file3d: a.file3d, // 3D filename in asset3d/ (dev store) — preferred
          file2d: a.file2d, // 2D image filename in asset3d/ (for teammates on pull)
          frameCount: a.frameCount, // >1 = the model's animation was baked to a spritesheet
          frameRate: a.frameRate
        });
        this.setHint(`Click a cell to place “${a.name}”`);
      }
    } catch (e) {
      this.setHint('Import failed: ' + (e as Error).message);
    }
  }

  private setHint(t: string): void {
    (this.q('.me-hint') as HTMLElement).textContent = t;
  }

  /** After a JSON import, list the asset3d/ files that are referenced but not on disk,
   *  so the user can paste them in and re-import to recover everything. */
  private showMissing(files: string[]): void {
    const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    (this.q('.me-missing-title') as HTMLElement).innerHTML =
      `<i class="fa-solid fa-triangle-exclamation"></i> ${files.length} fichier(s) manquant(s)`;
    (this.q('.me-missing-sub') as HTMLElement).textContent =
      'Colle ces fichiers dans le dossier asset3d/, puis ré-importe le même JSON pour tout récupérer. (Les images 2D sont déjà intégrées ; seuls les modèles 3D / originaux peuvent manquer.)';
    (this.q('.me-missing-list') as HTMLElement).innerHTML = files.map((f) => `<div class="f">asset3d/${esc(f)}</div>`).join('');
    this.q('.me-missing').classList.add('show');
  }

  private render(): void {
    this.root.classList.toggle('open', editorStore.open);
    if (!editorStore.open) {
      this.viewObjects = false; // reset toggles so a reopen starts clean
      this.viewAssets = false;
      return;
    }

    this.root.querySelectorAll<HTMLButtonElement>('.me-tab').forEach((b) =>
      b.classList.toggle('active', b.dataset.tab === editorStore.tab)
    );
    this.q('.me-edit').classList.toggle('show', editorStore.tab === 'edit');
    this.q('.me-assets').classList.toggle('show', editorStore.tab === 'assets');
    this.q('.me-position').classList.toggle('show', editorStore.tab === 'position');
    this.q('.me-grille').classList.toggle('show', editorStore.tab === 'grille');
    this.q('.me-carte').classList.toggle('show', editorStore.tab === 'carte');

    this.root.querySelectorAll<HTMLButtonElement>('.me-tool').forEach((b) =>
      b.classList.toggle('active', b.dataset.tool === editorStore.tool)
    );
    this.q('.me-darken').classList.toggle('active', editorStore.darken);
    this.q('.me-blackout').classList.toggle('active', editorStore.blackout);
    const lvlInput = this.q<HTMLInputElement>('.me-lvlinput');
    if (document.activeElement !== lvlInput) lvlInput.value = String(editorStore.allocLevel);

    // "Voir" (top-right) — floating list of every object in the game.
    this.q('.me-objects').classList.toggle('active', this.viewObjects);
    (this.q('.me-objpanel') as HTMLElement).classList.toggle('show', this.viewObjects);
    if (this.viewObjects) this.renderObjectPanel();

    // Level pager ‹ Level N · n/m › — each map is an independent LEVEL (Level 1 =
    // the main game; Level 2+ never affect Level 1). Shown once seeded.
    const nMaps = editorStore.maps.length;
    const pager = this.q('.me-pager') as HTMLElement;
    pager.classList.toggle('show', nMaps > 0);
    if (nMaps > 0) {
      (pager.querySelector('.lvl') as HTMLElement).textContent = `Level ${editorStore.currentMap + 1}`;
      (pager.querySelector('.cnt') as HTMLElement).textContent = `${editorStore.currentMap + 1}/${nMaps}`;
    }

    // Delete-map (bottom-right) — any map (incl. the default) as long as another
    // remains to take over; the pager is never emptied.
    const cur = editorStore.currentMapLayer;
    const delmap = this.q('.me-delmap') as HTMLElement;
    delmap.classList.toggle('show', editorStore.maps.length > 1);
    delmap.title = cur?.base ? 'Supprimer la map par défaut (la suivante devient principale)' : 'Delete this map';

    // pending-asset preview
    const preview = this.q('.me-preview') as HTMLElement;
    const pending = editorStore.pendingAsset;
    preview.classList.toggle('show', editorStore.tab === 'assets' && !!pending);
    if (pending) {
      (preview.querySelector('img') as HTMLImageElement).src = this.previewProvider?.(pending.textureKey) ?? '';
      (preview.querySelector('span') as HTMLElement).textContent = pending.name;
    }

    // transform panel (x/y/z + size) — appears when an asset is selected
    const xform = this.q('.me-xform') as HTMLElement;
    const sel = editorStore.selectedAsset;
    xform.classList.toggle('show', editorStore.tab === 'assets' && !!sel);
    if (sel) {
      const setIf = (cls: string, v: number) => {
        const el = this.q<HTMLInputElement>(cls);
        if (document.activeElement !== el) el.value = String(v);
      };
      setIf('.me-x', sel.col);
      setIf('.me-y', sel.row);
      setIf('.me-z', sel.z ?? 0);
      setIf('.me-size-input', sel.scale);
      setIf('.me-rot-input', sel.rot ?? 0);
      setIf('.me-rot-num', sel.rot ?? 0);
      this.q('.me-flipx').classList.toggle('active', !!sel.flipX);
      this.q('.me-flipy').classList.toggle('active', !!sel.flipY);
    }

    // Fixe/Modifiable segmented control — for the selected asset, else the pending one.
    const mv = this.q('.me-movable') as HTMLElement;
    const mvTarget = sel ?? pending;
    mv.classList.toggle('show', editorStore.tab === 'assets' && !!mvTarget);
    if (mvTarget) {
      const on = !!mvTarget.movable;
      mv.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
        b.classList.toggle('active', (b.dataset.mv === '1') === on)
      );
    }

    // "Voir" — the assets-in-this-map list (Assets tab).
    this.q('.me-view').classList.toggle('active', this.viewAssets);
    const showAssetList = editorStore.tab === 'assets' && this.viewAssets;
    (this.q('.me-asset-list') as HTMLElement).style.display = showAssetList ? 'flex' : 'none';
    if (showAssetList) this.renderAssetList();

    if (editorStore.tab === 'position') this.renderPositions();

    // Grille tab — hand-drawn grid definitions (foundation): draw tool + list + form.
    if (editorStore.tab === 'grille') {
      const drawing = editorStore.drawingGrid;
      this.q('.me-newgrid').classList.toggle('active', drawing);
      (this.q('.me-newgrid') as HTMLElement).innerHTML = drawing
        ? '<i class="fa-solid fa-xmark"></i> Annuler'
        : '<i class="fa-solid fa-plus"></i> Nouvelle grille';
      this.q('.me-griddrawhint').classList.toggle('show', drawing);
      const selGrid = editorStore.selectedGrid;
      this.q('.me-gridform').classList.toggle('show', !!selGrid && !drawing);
      if (selGrid && !drawing) {
        const persp = this.q<HTMLSelectElement>('.me-gpersp');
        if (document.activeElement !== persp) persp.value = selGrid.persp;
        const put = (cls: string, v: number) => {
          const el = this.q<HTMLInputElement>(cls);
          if (document.activeElement !== el) el.value = String(Math.round(v));
        };
        put('.me-gcols', selGrid.cols);
        put('.me-grows', selGrid.rows);
        const box = editorStore.gridBox(selGrid.id);
        if (box) {
          put('.me-gw', box.w);
          put('.me-gh', box.h);
          put('.me-gox', box.x);
          put('.me-goy', box.y);
        }
        put('.me-grot', selGrid.rot ?? 0);
      }
      this.renderGridList();
    }

    // Carte tab — draw-zone tool state, grid toggle label, zone list.
    if (editorStore.tab === 'carte') {
      this.renderZoneGridPicker();
      this.q('.me-trace').classList.toggle('active', editorStore.drawingZone);
      (this.q('.me-trace') as HTMLElement).innerHTML = editorStore.drawingZone
        ? '<i class="fa-solid fa-xmark"></i> Annuler le tracé'
        : '<i class="fa-solid fa-draw-polygon"></i> Tracer une zone';
      this.q('.me-tracehint').classList.toggle('show', editorStore.drawingZone);
      this.q('.me-finish').classList.toggle('show', editorStore.drawingZone);

      // Per-zone grid (calibrate on one tile) — needs a selected zone.
      const selZone = editorStore.selectedZone;
      const calib = editorStore.calibratingGrid;
      const addgrid = this.q<HTMLButtonElement>('.me-addgrid');
      addgrid.disabled = editorStore.drawingZone || (!selZone && !calib);
      addgrid.innerHTML = calib
        ? '<i class="fa-solid fa-xmark"></i> Annuler la grille'
        : '<i class="fa-solid fa-table-cells"></i> Ajouter une grille';
      this.q('.me-gridhint').classList.toggle('show', calib);
      (this.q('.gc') as HTMLElement).textContent = String(editorStore.calibPoints.length);
      this.q('.me-delgrid').classList.toggle('show', !!selZone?.grid && !calib && !editorStore.drawingZone);

      // Precise X/Y/W/H fields — shown when a zone is selected (and not drawing/calibrating).
      const showForm = !!selZone && !editorStore.drawingZone && !calib;
      this.q('.me-zoneform').classList.toggle('show', showForm);
      if (showForm && selZone) {
        const b = editorStore.zoneBounds(selZone.id);
        const put = (cls: string, v: number) => {
          const el = this.q<HTMLInputElement>(cls);
          if (document.activeElement !== el) el.value = String(Math.round(v));
        };
        if (b) {
          put('.me-zx', b.x);
          put('.me-zy', b.y);
          put('.me-zw', b.w);
          put('.me-zh', b.h);
        }
      }

      (this.q('.gt-label') as HTMLElement).textContent = editorStore.showGrid
        ? 'Grille carrée : masquer'
        : 'Grille carrée : afficher';
      this.renderZoneList();
    }

    const h = editorStore.hoverCell;
    (this.q('.vx') as HTMLElement).textContent = h ? String(h.col) : '--';
    (this.q('.vy') as HTMLElement).textContent = h ? String(h.row) : '--';
    (this.q('.vz') as HTMLElement).textContent = h ? '0' : '--';
  }

  private renderPositions(): void {
    const list = this.q('.me-position .me-list') as HTMLElement;
    const rows = this.listObjects();
    if (rows.length === 0) {
      list.innerHTML = '<div class="me-empty">No objects on the map</div>';
      return;
    }
    list.innerHTML = rows
      .map(
        (e) => `<div class="me-row${e.id === editorStore.selectedAssetId ? ' sel' : ''}" data-id="${e.id}">
          <span class="nm">${e.name}</span>
          <span class="co">x${e.col} y${e.row} z${e.z}</span>
          <span class="rk">#${e.rank}</span>
        </div>`
      )
      .join('');
    list.querySelectorAll<HTMLElement>('.me-row').forEach((r) =>
      r.addEventListener('click', () => this.onFocus(r.dataset.id!))
    );
  }

  /** Top-right "Voir": every object in the game (dragons, house, items, placed
   *  assets) — click a row to focus/select it on the board. */
  private renderObjectPanel(): void {
    const list = this.q('.me-obj-list') as HTMLElement;
    const rows = this.listObjects();
    if (rows.length === 0) {
      list.innerHTML = '<div class="me-empty">No objects in game</div>';
      return;
    }
    list.innerHTML = rows
      .map(
        (e) => `<div class="me-row${e.id === editorStore.selectedAssetId ? ' sel' : ''}" data-id="${e.id}">
          <span class="nm">${e.name}</span>
          <span class="co">x${e.col} y${e.row}</span>
          <span class="rk">#${e.rank}</span>
        </div>`
      )
      .join('');
    list.querySelectorAll<HTMLElement>('.me-row').forEach((r) =>
      r.addEventListener('click', () => this.onFocus(r.dataset.id!))
    );
  }

  /** "Voir": every asset placed on the current map — click to select it. */
  private renderAssetList(): void {
    const list = this.q('.me-asset-list') as HTMLElement;
    const rows = editorStore.assetsOnCurrentMap;
    if (rows.length === 0) {
      list.innerHTML = '<div class="me-empty">No assets in this map</div>';
      return;
    }
    list.innerHTML = rows
      .map(
        (a) => `<div class="me-row${a.id === editorStore.selectedAssetId ? ' sel' : ''}" data-id="${a.id}">
          <span class="nm">${a.name}</span>
          <span class="co">x${a.col} y${a.row}</span>
          <button class="del" data-del="${a.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>`
      )
      .join('');
    list.querySelectorAll<HTMLElement>('.me-row').forEach((r) =>
      r.addEventListener('click', () => editorStore.selectAsset(r.dataset.id!))
    );
    list.querySelectorAll<HTMLButtonElement>('.del').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation(); // don't also select the row
        this.onDeleteAsset(b.dataset.del!); // removes the asset AND its asset3d/ file
      })
    );
  }

  /** Grid list (Grille tab): each defined grid with an editable name + delete; click
   *  a row to select it (highlights it on the board). Rebuilt only when the set of
   *  grids changes, so typing a name never loses focus mid-keystroke. */
  private gridListSig = '';
  private renderGridList(): void {
    const list = this.q('.me-grid-list') as HTMLElement;
    const grids = editorStore.grids;
    const sig = grids.map((g) => g.id).join(',');
    const esc = (s: string): string =>
      s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (sig !== this.gridListSig) {
      this.gridListSig = sig;
      list.innerHTML = grids.length
        ? grids
            .map(
              (g) => `<div class="me-row" data-id="${g.id}">
          <input class="zname" data-id="${g.id}" value="${esc(g.name)}"/>
          <span class="co">${g.cols}×${g.rows}</span>
          <button class="del" data-del="${g.id}" title="Supprimer"><i class="fa-solid fa-trash"></i></button>
        </div>`
            )
            .join('')
        : '<div class="me-empty">Aucune grille — clique « Nouvelle grille »</div>';
      list.querySelectorAll<HTMLElement>('.me-row').forEach((r) =>
        r.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.zname, .del')) return; // let inputs/buttons act
          editorStore.selectGrid(r.dataset.id!);
        })
      );
      list.querySelectorAll<HTMLInputElement>('.zname').forEach((inp) =>
        inp.addEventListener('input', () => editorStore.renameGrid(inp.dataset.id!, inp.value))
      );
      list.querySelectorAll<HTMLButtonElement>('.del').forEach((b) =>
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          editorStore.removeGrid(b.dataset.del!);
        })
      );
    }
    // Refresh selection highlight + labels WITHOUT rebuilding (keeps input focus).
    list.querySelectorAll<HTMLElement>('.me-row').forEach((r) => {
      r.classList.toggle('sel', r.dataset.id === editorStore.selectedGridId);
      const g = grids.find((x) => x.id === r.dataset.id);
      const co = r.querySelector<HTMLElement>('.co');
      if (co && g) co.textContent = `${g.cols}×${g.rows}`;
      const inp = r.querySelector<HTMLInputElement>('.zname');
      if (inp && g && document.activeElement !== inp) inp.value = g.name;
    });
  }

  /** The Carte-tab "Grille" dropdown: pick which defined grid the next zone snaps
   *  to. Rebuilt only when the grid set changes; the selection follows selectedGrid. */
  private zoneGridSig = '';
  private renderZoneGridPicker(): void {
    const row = this.q('.me-zonegridrow') as HTMLElement;
    const sel = this.q<HTMLSelectElement>('.me-zonegrid');
    const grids = editorStore.grids;
    row.classList.toggle('show', grids.length > 0);
    const sig = grids.map((g) => `${g.id}:${g.name}`).join(',');
    if (sig !== this.zoneGridSig) {
      this.zoneGridSig = sig;
      const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      sel.innerHTML =
        '<option value="">— libre —</option>' +
        grids.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
    }
    if (document.activeElement !== sel) sel.value = editorStore.selectedGridId ?? '';
  }

  /** Zone list (Carte tab): each drawn zone with an editable name + delete; click a
   *  row to select it (highlights it on the board). Rebuilt only when the set of
   *  zones changes, so typing a name never loses focus mid-keystroke. */
  private zoneListSig = '';
  private renderZoneList(): void {
    const list = this.q('.me-zone-list') as HTMLElement;
    const zones = editorStore.zones;
    const sig = zones.map((z) => z.id).join(',');
    const esc = (s: string): string =>
      s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (sig !== this.zoneListSig) {
      this.zoneListSig = sig;
      list.innerHTML = zones.length
        ? zones
            .map(
              (z) => `<div class="me-row" data-id="${z.id}">
          <input class="zname" data-id="${z.id}" value="${esc(z.name)}"/>
          <span class="co">${z.points.length} pts</span>
          <button class="del" data-del="${z.id}" title="Supprimer"><i class="fa-solid fa-trash"></i></button>
        </div>`
            )
            .join('')
        : '<div class="me-empty">Aucune zone — clique « Tracer une zone »</div>';
      list.querySelectorAll<HTMLElement>('.me-row').forEach((r) =>
        r.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.zname, .del')) return; // let inputs/buttons act
          editorStore.selectZone(r.dataset.id!);
        })
      );
      list.querySelectorAll<HTMLInputElement>('.zname').forEach((inp) =>
        inp.addEventListener('input', () => editorStore.renameZone(inp.dataset.id!, inp.value))
      );
      list.querySelectorAll<HTMLButtonElement>('.del').forEach((b) =>
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          editorStore.removeZone(b.dataset.del!);
        })
      );
    }
    // Refresh selection highlight + names WITHOUT rebuilding (keeps input focus).
    list.querySelectorAll<HTMLElement>('.me-row').forEach((r) => {
      r.classList.toggle('sel', r.dataset.id === editorStore.selectedZoneId);
      const inp = r.querySelector<HTMLInputElement>('.zname');
      const z = zones.find((x) => x.id === r.dataset.id);
      if (inp && z && document.activeElement !== inp) inp.value = z.name;
    });
  }

  destroy(): void {
    this.off();
    document.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }
}
