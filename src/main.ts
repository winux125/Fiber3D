import "@fontsource/ibm-plex-sans/cyrillic-300.css";
import "@fontsource/ibm-plex-sans/latin-300.css";
import "@fontsource/ibm-plex-sans/cyrillic-400.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/cyrillic-600.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "./style.css";

import { CABLE_TYPES, NetworkStore } from "./store";
import type {
  CableStatus,
  CableTypeId,
  InteractionMode,
  ModelBounds,
  ModelFootprintPoint,
  NodeKind,
  NodePlacementMode,
  NodeState,
  Vector3Data,
} from "./types";

const [{ VillageMap }, { VillageScene }] = await Promise.all([import("./map"), import("./scene")]);

const app = document.querySelector<HTMLDivElement>("#app")!;
const store = new NetworkStore();

const icons = {
  logo: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 24V12m18 8V8M7 18h7a5 5 0 0 0 5-5V8m0 5v7a4 4 0 0 0 4 4h2"/><circle cx="7" cy="8" r="3"/><circle cx="7" cy="26" r="3"/><circle cx="25" cy="6" r="3"/><circle cx="25" cy="24" r="3"/></svg>`,
  cube: `<svg viewBox="0 0 24 24"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v8.5"/></svg>`,
  map: `<svg viewBox="0 0 24 24"><path d="m3 6 5-2 8 3 5-2v13l-5 2-8-3-5 2V6Z"/><path d="M8 4v13m8-10v13"/></svg>`,
  split: `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg>`,
  cursor: `<svg viewBox="0 0 24 24"><path d="m5 3 14 9-6 1-3 6-5-16Z"/></svg>`,
  node: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2"/></svg>`,
  cable: `<svg viewBox="0 0 24 24"><path d="M5 5v5a4 4 0 0 0 4 4h6a4 4 0 0 1 4 4v1"/><circle cx="5" cy="4" r="2"/><circle cx="19" cy="20" r="2"/></svg>`,
  upload: `<svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M5 14v5h14v-5"/></svg>`,
  download: `<svg viewBox="0 0 24 24"><path d="M12 4v12m0 0 5-5m-5 5-5-5"/><path d="M5 20h14"/></svg>`,
  locate: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2V4m0 16v2M2 12h2m16 0h2"/></svg>`,
  trash: `<svg viewBox="0 0 24 24"><path d="M4 7h16M9 3h6l1 4H8l1-4Z"/><path d="m7 7 1 14h8l1-14M10 11v6m4-6v6"/></svg>`,
  reset: `<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/></svg>`,
  plus: `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`,
  close: `<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>`,
  panelLeft: `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16"/><path d="M9 4v16M6 9l-2 3 2 3"/></svg>`,
  panelRight: `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16"/><path d="M15 4v16m3-11 2 3-2 3"/></svg>`,
  align: `<svg viewBox="0 0 24 24"><path d="M12 2v20M2 12h20M12 2l-3 3m3-3 3 3M22 12l-3-3m3 3-3 3M12 22l3-3m-3 3-3-3M2 12l3 3m-3-3 3-3"/></svg>`,
  layers: `<svg viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg>`,
  building: `<svg viewBox="0 0 24 24"><path d="M4 21V7l8-4 8 4v14M8 9h2m4 0h2M8 13h2m4 0h2M8 17h2m4 0h2M2 21h20"/></svg>`,
  ground: `<svg viewBox="0 0 24 24"><path d="M2 16c3-3 6 3 9 0s6 3 11 0M2 20h20"/><path d="M12 4v8m0 0-3-3m3 3 3-3"/></svg>`,
};

app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">${icons.logo}</div>
        <div>
          <div class="brand-name">FiberPlan <span>3D</span></div>
          <div class="brand-subtitle">FTTH network engineering</div>
        </div>
      </div>

      <button class="project-switch" type="button" aria-label="Текущий проект">
        <span class="project-icon">${icons.locate}</span>
        <span>
          <small>Рабочая область</small>
          <strong id="project-name">${store.state.village.name}</strong>
        </span>
        <span class="chevron">⌄</span>
      </button>

      <div class="view-switch" aria-label="Режим отображения">
        <button class="view-button is-active" data-view="3d" title="3D">${icons.cube}<span>3D</span></button>
        <button class="view-button" data-view="split" title="Разделить">${icons.split}<span>Split</span></button>
        <button class="view-button" data-view="map" title="Карта">${icons.map}<span>Карта</span></button>
      </div>

      <div class="panel-switch" aria-label="Панели интерфейса">
        <button class="panel-button is-active" data-panel="left" type="button" title="Левая панель" aria-pressed="true">${icons.panelLeft}</button>
        <button class="panel-button is-active" data-panel="right" type="button" title="Правая панель" aria-pressed="true">${icons.panelRight}</button>
      </div>

      <div class="top-actions">
        <input id="model-file" type="file" accept=".zip,.glb,.gltf,application/zip,model/gltf-binary,model/gltf+json" hidden />
        <button class="button button-ghost" id="import-model" type="button">${icons.upload}<span>Открыть ZIP / GLB</span></button>
        <button class="button button-primary" id="export-plan" type="button">${icons.download}<span>Экспорт схемы</span></button>
      </div>
    </header>

    <main class="main-grid">
      <aside class="left-panel">
        <section class="location-card">
          <div class="eyebrow">Текущая территория</div>
          <div class="location-title">
            <div class="location-pin">${icons.locate}</div>
            <div>
              <h1 id="location-name">${store.state.village.name}</h1>
              <p id="location-district">${store.state.village.district}</p>
            </div>
          </div>
          <div class="coordinates">
            <span id="village-lat">${store.state.village.lat.toFixed(5)}° N</span>
            <span id="village-lon">${store.state.village.lon.toFixed(5)}° E</span>
          </div>
          <div class="project-health">
            <span><i></i> Схема сохранена локально</span>
            <strong id="node-count">0 узлов</strong>
          </div>
        </section>

        <section class="panel-section tools-section">
          <div class="section-heading">
            <div>
              <span class="eyebrow">Инструменты</span>
              <h2>Редактор сети</h2>
            </div>
            <span class="key-hint">ESC</span>
          </div>
          <div class="tool-grid">
            <button class="tool-button is-active" data-mode="explore" type="button">
              ${icons.cursor}<span><strong>Осмотр</strong><small>Камера и выбор</small></span>
            </button>
            <button class="tool-button" data-mode="add-node" type="button">
              ${icons.node}<span><strong>Новый узел</strong><small>Точка на модели</small></span>
            </button>
            <button class="tool-button tool-button-wide" data-mode="connect" type="button">
              ${icons.cable}<span><strong>Проложить кабель</strong><small>Выберите два узла</small></span>
            </button>
          </div>
          <div class="placement-control">
            <div>
              <span class="eyebrow">Высота новой точки</span>
              <small id="placement-description">На верхней поверхности здания</small>
            </div>
            <div class="placement-switch" aria-label="Режим высоты узла">
              <button class="is-active" data-placement="surface" type="button" title="Размещать на крыше или выбранной поверхности">${icons.building}</button>
              <button data-placement="ground" type="button" title="Размещать на уровне земли">${icons.ground}</button>
            </div>
          </div>
        </section>

        <section class="panel-section cable-section">
          <div class="section-heading">
            <div>
              <span class="eyebrow">Материал</span>
              <h2>Тип кабеля</h2>
            </div>
            <span class="catalog-count">${CABLE_TYPES.length}</span>
          </div>
          <div class="cable-catalog">
            ${CABLE_TYPES.map(
              (type, index) => `
                <button class="cable-option${index === 0 ? " is-active" : ""}" data-cable-type="${type.id}" type="button">
                  <span class="cable-swatch" style="--cable-color:${type.cssColor}"><i></i></span>
                  <span>
                    <strong>${type.name}</strong>
                    <small>${type.description}</small>
                  </span>
                  <b>${type.cores}F</b>
                </button>
              `,
            ).join("")}
          </div>
        </section>

        <div class="left-footer">
          <button id="restore-demo" class="text-button" type="button">${icons.reset} Восстановить демо</button>
        </div>
      </aside>

      <section class="workspace" data-view="3d">
        <div id="scene-host" class="scene-host"></div>
        <div class="scene-vignette"></div>
        <div class="north-indicator"><span>N</span><i></i></div>

        <div class="interaction-hint" id="interaction-hint">
          ${icons.cursor}
          <span>Мышь — вращение · стрелки — перемещение · колесо — масштаб</span>
        </div>

        <div class="map-card">
          <div class="map-card-head">
            <div>
              <span class="eyebrow">Геопозиция</span>
              <strong id="map-village-name">${store.state.village.name}</strong>
            </div>
            <div class="map-card-actions">
              <button id="toggle-basemap" type="button" title="Переключить схему и спутник" aria-pressed="false">${icons.layers}</button>
              <button id="toggle-calibration" type="button" title="Калибровать положение модели" aria-pressed="false">${icons.align}</button>
              <button id="focus-map" type="button" title="Вернуться к территории">${icons.locate}</button>
            </div>
          </div>
          <div id="map-host" class="map-host"></div>
          <section class="map-calibration" id="map-calibration" hidden>
            <div class="calibration-heading">
              <div>
                <span class="eyebrow">Точная привязка</span>
                <strong>Положение и направление</strong>
              </div>
              <button id="reset-map-alignment" type="button" title="Вернуть геопривязку из матрицы 3D Tiles">Авто из ZIP</button>
            </div>
            <div class="calibration-controls">
              <div class="nudge-grid" aria-label="Сдвиг модели по сторонам света">
                <button class="nudge-north" data-nudge-east="0" data-nudge-south="-1" type="button" title="Сдвинуть на север">↑</button>
                <button class="nudge-west" data-nudge-east="-1" data-nudge-south="0" type="button" title="Сдвинуть на запад">←</button>
                <span>${icons.locate}</span>
                <button class="nudge-east" data-nudge-east="1" data-nudge-south="0" type="button" title="Сдвинуть на восток">→</button>
                <button class="nudge-south" data-nudge-east="0" data-nudge-south="1" type="button" title="Сдвинуть на юг">↓</button>
              </div>
              <div class="calibration-settings">
                <label class="alignment-step">
                  <span>Шаг сдвига</span>
                  <select id="map-alignment-step">
                    <option value="1">1 м</option>
                    <option value="5" selected>5 м</option>
                    <option value="10">10 м</option>
                  </select>
                </label>
                <div class="rotation-buttons" aria-label="Поворот модели">
                  <button data-rotate="-1" type="button" title="Против часовой стрелки на 0,1°">↺</button>
                  <span>Угол</span>
                  <button data-rotate="1" type="button" title="По часовой стрелке на 0,1°">↻</button>
                </div>
                <small>0,1° · Shift — 1°</small>
              </div>
            </div>
            <p id="map-alignment-offset">Восток 0 м · Север 0 м · Поворот 0°</p>
          </section>
        </div>

        <div class="loading-overlay" id="loading-overlay" hidden>
          <div class="loader-orbit"><i></i><i></i><i></i></div>
          <strong id="loading-title">Подготавливаем 3D-модель</strong>
          <span id="loading-detail">Файл остаётся на этом компьютере</span>
          <div class="loading-progress" aria-hidden="true"><i id="loading-progress-bar"></i></div>
        </div>
      </section>

      <aside class="right-panel">
        <div class="right-heading">
          <div>
            <span class="eyebrow">Трассы</span>
            <h2>Схема подключений</h2>
          </div>
          <button class="icon-button" data-mode-shortcut="connect" title="Новая линия">${icons.plus}</button>
        </div>

        <div class="summary-grid">
          <div class="metric metric-wide">
            <span class="metric-icon metric-green">${icons.cable}</span>
            <div><small>Общая длина</small><strong id="total-length">0 м</strong></div>
            <em id="active-cables">0 линий</em>
          </div>
          <div class="metric">
            <small>Подключено</small>
            <strong id="connected-homes">0</strong>
            <span>объектов</span>
          </div>
          <div class="metric">
            <small>Запланировано</small>
            <strong id="planned-length">0</strong>
            <span>метров</span>
          </div>
        </div>

        <div class="route-filter">
          <button class="is-active" type="button">Все линии</button>
          <span id="route-count">0</span>
        </div>
        <div class="network-filters">
          <div class="network-filter-head">
            <strong>Что показывать</strong>
            <button id="reset-network-filters" type="button">Сбросить</button>
          </div>
          <div class="network-filter-group">
            <span>Состояние линий</span>
            <div>
              <button class="is-active" data-filter-status="active" type="button">Активные</button>
              <button class="is-active" data-filter-status="planned" type="button">План</button>
              <button class="is-active" data-filter-status="maintenance" type="button">Обслуживание</button>
            </div>
          </div>
          <div class="network-filter-group">
            <span>Тип кабеля</span>
            <div>
              ${CABLE_TYPES.map(
                (type) =>
                  `<button class="is-active" data-filter-cable="${type.id}" type="button">${type.name}</button>`,
              ).join("")}
            </div>
          </div>
          <div class="network-filter-group">
            <span>Узлы</span>
            <div>
              <button class="is-active node-type-filter" data-filter-node="splice" style="--filter-color:#ff4ecd" type="button">Муфты</button>
              <button class="is-active node-type-filter" data-filter-node="pole" style="--filter-color:#18d5ff" type="button">Опоры</button>
              <button class="is-active node-type-filter" data-filter-node="house" style="--filter-color:#ffb000" type="button">Здания</button>
              <button class="is-active node-type-filter" data-filter-node="hub" style="--filter-color:#00a6ff" type="button">Узлы связи</button>
            </div>
          </div>
        </div>
        <div class="route-list" id="route-list"></div>

        <div class="capacity-card">
          <div class="capacity-top">
            <span>Резерв сети</span>
            <strong>62%</strong>
          </div>
          <div class="capacity-track"><i></i></div>
          <p>15 из 24 волокон свободны на магистрали</p>
        </div>
      </aside>
    </main>
  </div>

  <dialog id="node-dialog" class="node-dialog">
    <form id="node-form">
      <div class="dialog-head">
        <div>
          <span class="eyebrow">Новая точка сети</span>
          <h2>Добавить узел</h2>
        </div>
        <button class="icon-button" type="button" data-cancel-node aria-label="Закрыть">${icons.close}</button>
      </div>
      <label>
        <span>Название</span>
        <input name="name" required value="Муфта" autocomplete="off" />
      </label>
      <label>
        <span>Тип объекта</span>
        <select name="kind">
          <option value="splice">Оптическая муфта</option>
          <option value="pole">Опора</option>
          <option value="house">Абонент / здание</option>
          <option value="hub">Узел связи</option>
        </select>
      </label>
      <label>
        <span>Состояние</span>
        <select name="state">
          <option value="planned">План</option>
          <option value="online">Активен</option>
          <option value="warning">Требует внимания</option>
        </select>
      </label>
      <div class="position-preview" id="position-preview"></div>
      <div class="dialog-actions">
        <button class="button button-ghost" type="button" data-cancel-node>Отмена</button>
        <button class="button button-primary" type="submit">Добавить узел</button>
      </div>
    </form>
  </dialog>

  <div class="toast" id="toast" role="status"></div>
`;

const workspace = document.querySelector<HTMLElement>(".workspace")!;
const appShell = document.querySelector<HTMLElement>(".app-shell")!;
const mapCard = document.querySelector<HTMLElement>(".map-card")!;
const sceneHost = document.querySelector<HTMLElement>("#scene-host")!;
const mapHost = document.querySelector<HTMLElement>("#map-host")!;
const interactionHint = document.querySelector<HTMLElement>("#interaction-hint")!;
const routeList = document.querySelector<HTMLElement>("#route-list")!;
const modelInput = document.querySelector<HTMLInputElement>("#model-file")!;
const loadingOverlay = document.querySelector<HTMLElement>("#loading-overlay")!;
const loadingTitle = document.querySelector<HTMLElement>("#loading-title")!;
const loadingDetail = document.querySelector<HTMLElement>("#loading-detail")!;
const loadingProgressBar = document.querySelector<HTMLElement>("#loading-progress-bar")!;
const nodeDialog = document.querySelector<HTMLDialogElement>("#node-dialog")!;
const nodeForm = document.querySelector<HTMLFormElement>("#node-form")!;
const positionPreview = document.querySelector<HTMLElement>("#position-preview")!;
const toast = document.querySelector<HTMLElement>("#toast")!;
const calibrationPanel = document.querySelector<HTMLElement>("#map-calibration")!;
const calibrationToggle = document.querySelector<HTMLButtonElement>("#toggle-calibration")!;
const basemapToggle = document.querySelector<HTMLButtonElement>("#toggle-basemap")!;
const alignmentStep = document.querySelector<HTMLSelectElement>("#map-alignment-step")!;
const alignmentOffset = document.querySelector<HTMLElement>("#map-alignment-offset")!;

let selectedCableType: CableTypeId = "adss-24";
let activeMode: InteractionMode = "explore";
let nodePlacementMode: NodePlacementMode = "surface";
let pendingNodePosition: Vector3Data | null = null;
let toastTimer = 0;
const visibleCableTypes = new Set<CableTypeId>(CABLE_TYPES.map((type) => type.id));
const visibleCableStatuses = new Set<CableStatus>(["active", "planned", "maintenance"]);
const visibleNodeKinds = new Set<NodeKind>(["splice", "pole", "house", "hub"]);

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function setHint(message: string): void {
  interactionHint.querySelector("span")!.textContent = message;
  interactionHint.classList.remove("is-pulsing");
  requestAnimationFrame(() => interactionHint.classList.add("is-pulsing"));
}

function defaultNodeName(kind: NodeKind): string {
  const labels: Record<NodeKind, string> = {
    splice: "Муфта",
    pole: "Опора",
    house: "Абонент",
    hub: "Узел связи",
  };
  const nextNumber =
    store.state.nodes.filter((node) => !node.virtual && node.kind === kind).length + 1;
  return `${labels[kind]} ${nextNumber}`;
}

function requestNodePlacement(position: Vector3Data): void {
  pendingNodePosition = position;
  const placementLabel = nodePlacementMode === "surface" ? "на поверхности" : "на земле";
  positionPreview.textContent =
    `${placementLabel} · X ${position.x.toFixed(1)} · Y ${position.y.toFixed(1)} · Z ${position.z.toFixed(1)} м`;
  const input = nodeForm.elements.namedItem("name") as HTMLInputElement;
  const kindSelect = nodeForm.elements.namedItem("kind") as HTMLSelectElement;
  input.value = defaultNodeName(kindSelect.value as NodeKind);
  if (!nodeDialog.open) nodeDialog.showModal();
  input.select();
}

function focusCableRoute(id: string): void {
  scene.focusCable(id);
  const row = routeList.querySelector<HTMLElement>(`[data-route="${id}"]`);
  row?.scrollIntoView({ behavior: "smooth", block: "center" });
  row?.classList.add("is-highlighted");
  window.setTimeout(() => row?.classList.remove("is-highlighted"), 1200);
}

function beginCableBranch(
  id: string,
  position: { x: number; z: number; y?: number },
): void {
  const junction = store.splitCableAt(id, position);
  if (!junction) {
    setHint("Не удалось выбрать точку ответвления");
    return;
  }
  scene.selectNodeFromMap(junction.id);
  setHint("Точка на линии выбрана · теперь укажите конечный узел");
  showToast("Ответвление начато с выбранного места кабеля");
}

const scene = new VillageScene(sceneHost, store, {
  onConnection(from, to) {
    const cable = store.addCable(from, to, selectedCableType);
    if (!cable) {
      setHint("Не удалось создать линию");
      return;
    }
    const type = store.getCableType(cable.type);
    showToast(`${type.name}: добавлена линия ${cable.lengthM.toFixed(1)} м`);
    setHint("Линия добавлена · выберите следующий начальный узел");
  },
  onNodePlacement: requestNodePlacement,
  onCableSelected: focusCableRoute,
  onCableBranch: beginCableBranch,
  onHint: setHint,
});

const villageMap = new VillageMap(mapHost, store, {
  onNodeSelected(id) {
    scene.selectNodeFromMap(id);
  },
  onNodePlacement(x, z) {
    requestNodePlacement(scene.positionFromMap(x, z));
  },
  onCableSelected: focusCableRoute,
  onCableBranch(id, x, z) {
    beginCableBranch(id, { x, z });
  },
});

function applyNetworkFilters(): void {
  scene.setVisibilityFilters(visibleCableTypes, visibleCableStatuses, visibleNodeKinds);
  villageMap.setVisibilityFilters(visibleCableTypes, visibleCableStatuses, visibleNodeKinds);
  document.querySelectorAll<HTMLButtonElement>("[data-filter-cable]").forEach((button) => {
    const active = visibleCableTypes.has(button.dataset.filterCable as CableTypeId);
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-filter-status]").forEach((button) => {
    const active = visibleCableStatuses.has(button.dataset.filterStatus as CableStatus);
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-filter-node]").forEach((button) => {
    const active = visibleNodeKinds.has(button.dataset.filterNode as NodeKind);
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderDashboard();
}

function resetNetworkFilters(): void {
  visibleCableTypes.clear();
  CABLE_TYPES.forEach((type) => visibleCableTypes.add(type.id));
  visibleCableStatuses.clear();
  (["active", "planned", "maintenance"] as CableStatus[]).forEach((status) =>
    visibleCableStatuses.add(status),
  );
  visibleNodeKinds.clear();
  (["splice", "pole", "house", "hub"] as NodeKind[]).forEach((kind) =>
    visibleNodeKinds.add(kind),
  );
  applyNetworkFilters();
}
basemapToggle.classList.toggle("is-active", villageMap.getBasemapMode() === "satellite");
basemapToggle.setAttribute(
  "aria-pressed",
  String(villageMap.getBasemapMode() === "satellite"),
);

function setMode(mode: InteractionMode): void {
  activeMode = mode;
  document.querySelectorAll<HTMLElement>("[data-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === mode);
  });
  scene.setMode(mode);
  villageMap.setMode(mode);
}

document.querySelectorAll<HTMLButtonElement>("[data-placement]").forEach((button) => {
  button.addEventListener("click", () => {
    nodePlacementMode = button.dataset.placement as NodePlacementMode;
    scene.setNodePlacementMode(nodePlacementMode);
    document.querySelectorAll<HTMLButtonElement>("[data-placement]").forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    document.querySelector("#placement-description")!.textContent =
      nodePlacementMode === "surface"
        ? "На верхней поверхности здания"
        : "На уровне земли рядом со зданием";
    setMode("add-node");
    setHint(
      nodePlacementMode === "surface"
        ? "Режим здания · кликните по крыше в 3D или по зданию на карте"
        : "Режим земли · уровень рельефа определяется рядом со зданием",
    );
  });
});

function updateViewButtons(view: string): void {
  document.querySelectorAll<HTMLElement>("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });
  villageMap.invalidateSize();
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character]!,
  );
}

function renderDashboard(): void {
  const state = store.state;
  const displayedCables = state.cables.filter(
    (cable) =>
      visibleCableTypes.has(cable.type) && visibleCableStatuses.has(cable.status),
  );
  const countedCables = state.cables.filter((cable) => cable.countInPlan !== false);
  const totalLength = countedCables.reduce(
    (sum, cable) => sum + cable.lengthM + cable.reserveM,
    0,
  );
  const plannedLength = state.cables
    .filter((cable) => cable.status === "planned" && cable.countInPlan !== false)
    .reduce((sum, cable) => sum + cable.lengthM + cable.reserveM, 0);
  const connectedNodeIds = new Set(state.cables.flatMap((cable) => [cable.from, cable.to]));
  const connectedHomes = state.nodes.filter(
    (node) => node.kind === "house" && connectedNodeIds.has(node.id),
  ).length;

  document.querySelector("#node-count")!.textContent = `${state.nodes.length} узлов`;
  document.querySelector("#project-name")!.textContent = state.village.name;
  document.querySelector("#location-name")!.textContent = state.village.name;
  document.querySelector("#location-district")!.textContent = state.village.district;
  document.querySelector("#map-village-name")!.textContent = state.village.name;
  document.querySelector("#village-lat")!.textContent = `${state.village.lat.toFixed(5)}° N`;
  document.querySelector("#village-lon")!.textContent = `${state.village.lon.toFixed(5)}° E`;
  document.querySelector("#total-length")!.textContent =
    totalLength >= 1000 ? `${(totalLength / 1000).toFixed(2)} км` : `${Math.round(totalLength)} м`;
  document.querySelector("#active-cables")!.textContent = `${state.cables.length} линий`;
  document.querySelector("#connected-homes")!.textContent = String(connectedHomes);
  document.querySelector("#planned-length")!.textContent = String(Math.round(plannedLength));
  document.querySelector("#route-count")!.textContent =
    displayedCables.length === state.cables.length
      ? String(state.cables.length)
      : `${displayedCables.length}/${state.cables.length}`;
  const east = state.mapAlignment.eastM;
  const north = -state.mapAlignment.southM;
  const rotation = state.mapAlignment.rotationDeg;
  const formatOffset = (value: number, positive: string, negative: string): string =>
    value === 0
      ? `${positive} 0 м`
      : `${value > 0 ? positive : negative} ${Math.abs(value).toFixed(1).replace(".0", "")} м`;
  alignmentOffset.textContent =
    `${formatOffset(east, "Восток", "Запад")} · ` +
    `${formatOffset(north, "Север", "Юг")} · ` +
    (rotation === 0
      ? "Поворот 0°"
      : `Поворот ${rotation > 0 ? "↻" : "↺"} ${Math.abs(rotation).toFixed(1)}°`);

  if (!state.cables.length) {
    routeList.innerHTML = `
      <div class="empty-routes">
        ${icons.cable}
        <strong>Линий пока нет</strong>
        <span>Добавьте два узла и соедините их кабелем</span>
        <button class="button button-primary" data-empty-connect>Проложить первую линию</button>
      </div>
    `;
    return;
  }

  if (!displayedCables.length) {
    routeList.innerHTML = `
      <div class="empty-routes empty-filter">
        ${icons.cable}
        <strong>По фильтру ничего нет</strong>
        <span>Включите другой тип или состояние линии</span>
        <button class="button button-primary" data-reset-filters>Показать всё</button>
      </div>
    `;
    return;
  }

  routeList.innerHTML = displayedCables
    .map((cable, index) => {
      const from = store.getNode(cable.from);
      const to = store.getNode(cable.to);
      const type = store.getCableType(cable.type);
      return `
        <article class="route-card${cable.countInPlan === false ? " is-excluded" : ""}" data-route="${cable.id}">
          <div class="route-index" style="--route-color:${type.cssColor}">${String(index + 1).padStart(2, "0")}</div>
          <div class="route-main">
            <div class="route-title">
              <strong>${escapeHtml(from?.name ?? "—")} → ${escapeHtml(to?.name ?? "—")}</strong>
              <select class="route-status status-${cable.status}" data-cable-status="${cable.id}" aria-label="Состояние линии">
                <option value="active"${cable.status === "active" ? " selected" : ""}>Активна</option>
                <option value="planned"${cable.status === "planned" ? " selected" : ""}>План</option>
                <option value="maintenance"${cable.status === "maintenance" ? " selected" : ""}>Обслуживание</option>
              </select>
            </div>
            <div class="route-meta">
              <span><i style="background:${type.cssColor}"></i>${type.name}</span>
              <b>${cable.lengthM.toFixed(1)} м</b>
              <span>+${cable.reserveM} м запас</span>
              <label class="plan-count-toggle">
                <input data-count-plan="${cable.id}" type="checkbox"${cable.countInPlan === false ? "" : " checked"} />
                <span>В расчёте</span>
              </label>
            </div>
          </div>
          <div class="route-actions">
            <button data-focus-route="${cable.id}" title="Показать в 3D">${icons.locate}</button>
            <button data-remove-route="${cable.id}" title="Удалить">${icons.trash}</button>
          </div>
        </article>
      `;
    })
    .join("");
}

store.addEventListener("change", () => {
  scene.renderNetwork();
  villageMap.render();
  renderDashboard();
});

document.querySelectorAll<HTMLElement>("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode as InteractionMode));
});
document.querySelector<HTMLElement>("[data-mode-shortcut]")!.addEventListener("click", () => {
  setMode("connect");
});

document.querySelectorAll<HTMLElement>("[data-cable-type]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedCableType = button.dataset.cableType as CableTypeId;
    document.querySelectorAll<HTMLElement>("[data-cable-type]").forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    if (activeMode !== "connect") setMode("connect");
    const cableType = store.getCableType(selectedCableType);
    setHint(`${cableType.name} выбран · укажите два узла`);
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-filter-cable]").forEach((button) => {
  button.addEventListener("click", () => {
    const type = button.dataset.filterCable as CableTypeId;
    if (visibleCableTypes.has(type)) visibleCableTypes.delete(type);
    else visibleCableTypes.add(type);
    applyNetworkFilters();
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-filter-status]").forEach((button) => {
  button.addEventListener("click", () => {
    const status = button.dataset.filterStatus as CableStatus;
    if (visibleCableStatuses.has(status)) visibleCableStatuses.delete(status);
    else visibleCableStatuses.add(status);
    applyNetworkFilters();
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-filter-node]").forEach((button) => {
  button.addEventListener("click", () => {
    const kind = button.dataset.filterNode as NodeKind;
    if (visibleNodeKinds.has(kind)) visibleNodeKinds.delete(kind);
    else visibleNodeKinds.add(kind);
    applyNetworkFilters();
  });
});

document.querySelector("#reset-network-filters")!.addEventListener("click", resetNetworkFilters);

document.querySelectorAll<HTMLElement>("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.view ?? "3d";
    workspace.dataset.view = view;
    updateViewButtons(view);
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-panel]").forEach((button) => {
  button.addEventListener("click", () => {
    const side = button.dataset.panel;
    if (side !== "left" && side !== "right") return;
    const className = side === "left" ? "is-left-hidden" : "is-right-hidden";
    const hidden = appShell.classList.toggle(className);
    button.classList.toggle("is-active", !hidden);
    button.setAttribute("aria-pressed", String(!hidden));
    window.setTimeout(() => {
      villageMap.invalidateSize();
      window.dispatchEvent(new Event("resize"));
    }, 190);
  });
});

routeList.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const focusButton = target.closest<HTMLElement>("[data-focus-route]");
  const removeButton = target.closest<HTMLElement>("[data-remove-route]");
  const emptyButton = target.closest<HTMLElement>("[data-empty-connect]");
  const resetButton = target.closest<HTMLElement>("[data-reset-filters]");
  if (focusButton) {
    scene.focusCable(focusButton.dataset.focusRoute!);
    workspace.dataset.view = "3d";
    updateViewButtons("3d");
  }
  if (removeButton) {
    store.removeCable(removeButton.dataset.removeRoute!);
    showToast("Линия удалена из плана");
  }
  if (emptyButton) setMode("connect");
  if (resetButton) resetNetworkFilters();
});

routeList.addEventListener("change", (event) => {
  const planToggle = (event.target as HTMLElement).closest<HTMLInputElement>("[data-count-plan]");
  if (planToggle) {
    const counted = store.toggleCableInPlan(planToggle.dataset.countPlan!);
    showToast(counted ? "Линия учитывается в плане" : "Линия исключена из расчёта");
    return;
  }
  const select = (event.target as HTMLElement).closest<HTMLSelectElement>("[data-cable-status]");
  if (!select) return;
  const status = select.value as CableStatus;
  if (store.setCableStatus(select.dataset.cableStatus!, status)) {
    showToast(
      status === "active"
        ? "Линия переведена в активные"
        : status === "planned"
          ? "Линия возвращена в план"
          : "Линия отмечена на обслуживании",
    );
  }
});

document.querySelector("#focus-map")!.addEventListener("click", () => villageMap.focusVillage());
basemapToggle.addEventListener("click", () => {
  const result = villageMap.toggleBasemap();
  const isSatellite = result.mode === "satellite";
  basemapToggle.classList.toggle("is-active", isSatellite);
  basemapToggle.setAttribute("aria-pressed", String(isSatellite));
  showToast(`${result.label}: слой карты переключён`);
});
calibrationToggle.addEventListener("click", () => {
  const isOpen = calibrationPanel.hasAttribute("hidden");
  calibrationPanel.toggleAttribute("hidden", !isOpen);
  mapCard.classList.toggle("is-calibrating", isOpen);
  calibrationToggle.classList.toggle("is-active", isOpen);
  calibrationToggle.setAttribute("aria-pressed", String(isOpen));
});

document.querySelectorAll<HTMLButtonElement>("[data-nudge-east]").forEach((button) => {
  button.addEventListener("click", () => {
    const step = Number(alignmentStep.value);
    const eastDelta = Number(button.dataset.nudgeEast) * step;
    const southDelta = Number(button.dataset.nudgeSouth) * step;
    store.adjustMapAlignment(eastDelta, southDelta);
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-rotate]").forEach((button) => {
  button.addEventListener("click", (event) => {
    const direction = Number(button.dataset.rotate);
    const increment = event.shiftKey ? 1 : 0.1;
    store.adjustMapRotation(direction * increment);
  });
});

document.querySelector("#reset-map-alignment")!.addEventListener("click", () => {
  store.resetMapAlignment();
  showToast("Восстановлена автоматическая геопривязка из ZIP");
});

document.querySelector("#import-model")!.addEventListener("click", () => modelInput.click());
modelInput.addEventListener("change", async () => {
  const file = modelInput.files?.[0];
  if (!file) return;
  const proceed =
    !store.state.nodes.length ||
    window.confirm("Импорт новой модели очистит текущую демо-схему. Продолжить?");
  if (!proceed) {
    modelInput.value = "";
    return;
  }
  loadingOverlay.hidden = false;
  loadingTitle.textContent = file.name.toLowerCase().endsWith(".zip")
    ? "Читаем 3D Tiles из ZIP"
    : "Подготавливаем 3D-модель";
  loadingDetail.textContent = "Файл остаётся на этом компьютере";
  loadingProgressBar.style.width = "3%";
  try {
    let importedOrigin: { lat: number; lon: number; alt: number } | undefined;
    let importedBounds: ModelBounds | null = null;
    let importedFootprint: ModelFootprintPoint[] = [];
    let successMessage = `${file.name} загружен · добавьте точки сети`;
    if (file.name.toLowerCase().endsWith(".zip")) {
      const result = await scene.loadZip(file, (progress) => {
        loadingDetail.textContent = progress.detail;
        const fraction = progress.total ? progress.current / progress.total : 0;
        const percent =
          progress.phase === "index"
            ? 4
            : progress.phase === "tileset"
              ? 12 + fraction * 8
              : 20 + fraction * 78;
        loadingProgressBar.style.width = `${Math.min(98, percent)}%`;
      });
      importedOrigin = result.origin ?? undefined;
      importedBounds = result.bounds;
      importedFootprint = result.footprint;
      successMessage = `${file.name}: загружено ${result.tileCount} тайлов · добавьте точки сети`;
    } else {
      loadingDetail.textContent = "Загружаем геометрию и материалы";
      loadingProgressBar.style.width = "38%";
      const result = await scene.loadGlb(file);
      importedBounds = result.bounds;
      importedFootprint = result.footprint;
    }
    store.clearForImportedModel(importedOrigin);
    villageMap.setModelBounds(importedBounds, importedFootprint);
    if (importedOrigin) {
      loadingDetail.textContent = "Определяем реальное название территории";
      loadingProgressBar.style.width = "98%";
      try {
        const { resolvePlaceName } = await import("./geocoding");
        const place = await resolvePlaceName(importedOrigin.lat, importedOrigin.lon);
        store.setVillageDetails({
          ...place,
          lat: importedOrigin.lat,
          lon: importedOrigin.lon,
          alt: importedOrigin.alt,
        });
      } catch (error) {
        console.warn("Не удалось определить название территории", error);
        store.setVillageDetails({
          name: `Территория ${importedOrigin.lat.toFixed(4)}, ${importedOrigin.lon.toFixed(4)}`,
          district: "Название не найдено в OpenStreetMap",
        });
      }
    } else {
      store.setVillageDetails({
        name: file.name.replace(/\.(glb|gltf)$/i, ""),
        district: "Локальная модель без географической привязки",
      });
    }
    loadingProgressBar.style.width = "100%";
    villageMap.focusVillage();
    setMode("add-node");
    showToast(successMessage);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "неизвестная ошибка";
    showToast(`Не удалось открыть модель: ${message}`);
  } finally {
    loadingOverlay.hidden = true;
    modelInput.value = "";
  }
});

document.querySelector("#export-plan")!.addEventListener("click", () => {
  const blob = new Blob([store.exportJson()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `fiberplan-${store.state.village.name.toLowerCase()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("Схема экспортирована в JSON");
});

document.querySelector("#restore-demo")!.addEventListener("click", () => {
  if (!window.confirm("Восстановить демонстрационное село и удалить текущую локальную схему?")) return;
  scene.restoreDemo();
  store.restoreDemo();
  villageMap.setModelBounds(null);
  villageMap.focusVillage();
  setMode("explore");
  showToast("Демонстрационная схема восстановлена");
});

nodeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!pendingNodePosition) return;
  const formData = new FormData(nodeForm);
  const name = String(formData.get("name") || "Новый узел").trim();
  const kind = String(formData.get("kind") || "splice") as NodeKind;
  const state = String(formData.get("state") || "planned") as NodeState;
  const node = store.addNode(name, kind, pendingNodePosition, state);
  pendingNodePosition = null;
  nodeDialog.close();
  scene.focusNode(node.id);
  setMode("connect");
  showToast(`${node.name} добавлен`);
});

const nodeKindSelect = nodeForm.elements.namedItem("kind") as HTMLSelectElement;
nodeKindSelect.addEventListener("change", () => {
  const input = nodeForm.elements.namedItem("name") as HTMLInputElement;
  input.value = defaultNodeName(nodeKindSelect.value as NodeKind);
  input.select();
});

document.querySelectorAll<HTMLElement>("[data-cancel-node]").forEach((button) => {
  button.addEventListener("click", () => {
    pendingNodePosition = null;
    nodeDialog.close();
  });
});

nodeDialog.addEventListener("cancel", () => {
  pendingNodePosition = null;
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && nodeDialog.open) {
    pendingNodePosition = null;
    nodeDialog.close();
  }
});

renderDashboard();
setMode("explore");
