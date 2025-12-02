import Phaser from 'phaser';
import ChunkManager from './world/chunkManager';

type LangKey = 'en' | 'zh';

type SaveData = {
  lang: LangKey;
  volume: number;
  player: { x: number; y: number };
  seenDialogs: string[];
};

type GridPoint = { x: number; y: number };
type WaypointNode = { id: string; pos: Phaser.Math.Vector2; neighbors: Set<string> };

const STORAGE_KEY = 'phaser-vite-demo-save';

export default class WorldScene extends Phaser.Scene {
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private velocity = 160;
  private dialogText?: Phaser.GameObjects.Text;
  private langButton?: Phaser.GameObjects.Text;
  private musicButton?: Phaser.GameObjects.Text;
  private lang: LangKey = 'en';
  private dictionaries: Record<LangKey, Record<string, any>> = { en: {}, zh: {} };
  private saveData: SaveData = {
    lang: 'en',
    volume: 0.5,
    player: { x: 629, y: 3280 },
    seenDialogs: [],
  };
  private bgm?: Phaser.Sound.BaseSound & { volume: number };
  private bgmReady = false;
  private interacted = false;
  private moveKeys?: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private lastVolume = 0.5;
  private activeDialogKey: string | null = null;
  private activeDialogOverrides: Partial<Record<LangKey, string>> = {};
  private chunkManager?: ChunkManager;
  private readonly tileSize = 32;
  private readonly chunkTileSize = 88;
  private readonly chunkViewDistance = 0;
  private npcs: Phaser.GameObjects.Sprite[] = [];
  private nearbyNpc: Phaser.GameObjects.Sprite | null = null;
  private interactionHint?: Phaser.GameObjects.Text;
  private interactionKeys?: Phaser.Input.Keyboard.Key[];
  private navGrid?: boolean[][];
  private navOrigin = new Phaser.Math.Vector2(0, 0);
  private gridWidth = 0;
  private gridHeight = 0;
  private waypointsLoaded = false;
  private waypoints: Map<string, WaypointNode> = new Map();
  private autoPath: Phaser.Math.Vector2[] = [];
  private autoPathIndex = 0;
  private readonly autoTurnRate = 0.18;
  private debugGraphics?: Phaser.GameObjects.Graphics;
  private debugFlags = { enabled: false, grid: false, path: false, log: false };
  private debugDirty = false;
  private debugLastPlayerTile?: GridPoint;
  private debugKeys?: {
    toggle: Phaser.Input.Keyboard.Key;
    grid: Phaser.Input.Keyboard.Key;
    path: Phaser.Input.Keyboard.Key;
    log: Phaser.Input.Keyboard.Key;
  };
  private positionDebugEnabled = false;
  private positionDebugText?: Phaser.GameObjects.Text;
  private positionDebugKey?: Phaser.Input.Keyboard.Key;
  private debugButtons?: {
    container: Phaser.GameObjects.Container;
    grid: Phaser.GameObjects.Text;
    path: Phaser.GameObjects.Text;
    log: Phaser.GameObjects.Text;
  };
  private resizeHandler?: (gameSize: Phaser.Structs.Size) => void;

  constructor() {
    super('WorldScene');
  }

  init() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        this.saveData = { ...this.saveData, ...JSON.parse(saved) };
      } catch (err) {
        console.warn('Failed to parse save data', err);
      }
    }
    this.lang = this.saveData.lang;
    this.lastVolume = this.saveData.volume || 0.5;
  }

  create() {
    this.dictionaries.en = this.cache.json.get('i18n-en') ?? {};
    this.dictionaries.zh = this.cache.json.get('i18n-zh') ?? {};

    this.player = this.physics.add.sprite(this.saveData.player.x, this.saveData.player.y, undefined as any);
    // Use an extra-small hitbox to make navigation through tight gaps easier.
    this.player.setSize(8, 12);
    this.player.setOffset(-4, -6);
    this.player.setTint(0xffffff);
    this.player.body.setCollideWorldBounds(true);

    const graphics = this.add.graphics();
    graphics.fillStyle(0xffffff, 1);
    graphics.fillRoundedRect(-12, -16, 24, 32, 6);
    graphics.generateTexture('player-rect', 24, 32);
    graphics.destroy();
    this.player.setTexture('player-rect');
    this.player.setDepth(2);

    this.chunkManager = new ChunkManager(this, {
      tileSize: this.tileSize,
      chunkTileSize: this.chunkTileSize,
      tilesetKey: 'Full_Liyue',
      tilesetName: 'Full_Liyue',
      baseKey: 'Liyue_city',
      viewDistance: this.chunkViewDistance,
      player: this.player,
      objectFactory: (obj, worldPosition) => this.createWorldObject(obj, worldPosition),
    });
    this.chunkManager.updateChunksAround(this.player.x, this.player.y);
    this.buildNavigationGrid();
    this.ensurePlayerSpawnValid();
    this.syncWorldBoundsToNav();
    this.registerResizeHandler();

    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setZoom(1.2);

    const keyboard = this.input.keyboard;
    if (!keyboard) {
      throw new Error('Keyboard manager unavailable');
    }

    this.cursors = keyboard.createCursorKeys();
    this.moveKeys = keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;

    this.interactionKeys = [
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
    ];

    this.debugKeys = {
      toggle: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F2),
      grid: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F3),
      path: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F4),
      log: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F6),
    };
    this.positionDebugKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F1);

    this.debugKeys.toggle.on('down', () => this.toggleDebug('toggle'));
    this.debugKeys.grid.on('down', () => this.toggleDebug('grid'));
    this.debugKeys.path.on('down', () => this.toggleDebug('path'));
    this.debugKeys.log.on('down', () => this.toggleDebug('log'));
    this.positionDebugKey.on('down', () => this.togglePositionDebug());

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.handleInteraction();
      if (this.isPointerOverUi(pointer)) return;
      this.planPathTo(pointer.worldX, pointer.worldY);
    });

    keyboard.once('keydown', () => this.handleInteraction());

    this.createUI();
    this.createDebugUi();
    this.updateUiText();
  }

  update() {
    if (!this.player || !this.cursors || !this.moveKeys) return;
    this.chunkManager?.updateChunksAround(this.player.x, this.player.y);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const manualVelocity = this.getManualInputVector();
    const navBounds = this.getNavBounds();
    if (navBounds && !this.isInsideNavBounds(this.player.x, this.player.y, navBounds)) {
      const clampedX = Phaser.Math.Clamp(this.player.x, navBounds.minX, navBounds.maxX - 1);
      const clampedY = Phaser.Math.Clamp(this.player.y, navBounds.minY, navBounds.maxY - 1);
      this.player.setPosition(clampedX, clampedY);
      body.setVelocity(0, 0);
      this.stopAutoMove();
      this.debugDirty = true;
    }

    if (manualVelocity.lengthSq() > 0) {
      this.stopAutoMove();
      manualVelocity.normalize().scale(this.velocity);
      body.setVelocity(manualVelocity.x, manualVelocity.y);
    } else if (this.autoPath.length > 0) {
      this.followAutoPath(body);
    } else {
      body.setVelocity(0, 0);
    }

    this.updateNearbyNpc();
    this.handleNpcInteraction();

    const playerTile = this.worldToGrid(this.player.x, this.player.y);
    if (
      !this.debugLastPlayerTile ||
      playerTile.x !== this.debugLastPlayerTile.x ||
      playerTile.y !== this.debugLastPlayerTile.y
    ) {
      this.debugLastPlayerTile = playerTile;
      this.debugDirty = true;
    }
    this.refreshDebug();
    if (this.positionDebugEnabled) {
      this.updatePositionDebug();
    }

    if (Math.abs(body.velocity.x) > 0 || Math.abs(body.velocity.y) > 0) {
      this.saveData.player = { x: this.player.x, y: this.player.y };
      this.persist();
    }
  }

  private getManualInputVector() {
    const velocity = new Phaser.Math.Vector2(0, 0);
    if (!this.cursors || !this.moveKeys) return velocity;
    const keys = this.moveKeys;

    if (this.cursors.left?.isDown || keys.left.isDown) velocity.x = -1;
    else if (this.cursors.right?.isDown || keys.right.isDown) velocity.x = 1;

    if (this.cursors.up?.isDown || keys.up.isDown) velocity.y = -1;
    else if (this.cursors.down?.isDown || keys.down.isDown) velocity.y = 1;

    return velocity;
  }

  private planPathTo(worldX: number, worldY: number) {
    this.buildNavigationGrid();
    if (!this.navGrid) return;
    this.loadWaypoints();

    const navBounds = this.getNavBounds();
    if (navBounds && !this.isInsideNavBounds(worldX, worldY, navBounds)) {
      this.stopAutoMove();
      if (this.debugFlags.log) {
        console.log('[pathfind] click outside nav bounds, ignoring', { worldX, worldY, navBounds });
      }
      return;
    }

    const start = this.worldToGrid(this.player.x, this.player.y);
    const target = this.worldToGrid(worldX, worldY);
    if (!this.isWalkable(start.x, start.y) && this.navGrid) {
      this.navGrid[start.y][start.x] = true;
    }

    const gridPath = this.buildGridPath(start, target);
    const waypointPath = this.buildWaypointPath(start, target);
    const chosenPath = this.pickPath(gridPath, waypointPath);

    if (chosenPath && chosenPath.length > 0) {
      this.startAutoMove(chosenPath);
    } else {
      this.stopAutoMove();
    }

    this.debugDirty = true;
    if (this.debugFlags.log) {
      console.log('[pathfind]', {
        start,
        target,
        startWalkable: this.isWalkable(start.x, start.y),
        targetWalkable: this.isWalkable(target.x, target.y),
        gridPath: gridPath?.length ?? 0,
        waypointPath: waypointPath?.length ?? 0,
        chosen: chosenPath?.length ?? 0,
      });
    }
    this.drawDebugGrid();
  }

  private startAutoMove(path: Phaser.Math.Vector2[]) {
    this.autoPath = path;
    this.autoPathIndex = 0;
    this.debugDirty = true;
    this.drawDebugPath();
  }

  private stopAutoMove() {
    this.autoPath = [];
    this.autoPathIndex = 0;
    this.debugDirty = true;
    this.drawDebugPath();
  }

  private pickPath(
    gridPath: Phaser.Math.Vector2[] | null,
    waypointPath: Phaser.Math.Vector2[] | null
  ): Phaser.Math.Vector2[] | null {
    if (gridPath && waypointPath) {
      const gridLen = this.measurePathLength(gridPath);
      const wpLen = this.measurePathLength(waypointPath);
      return wpLen < gridLen * 0.9 ? waypointPath : gridPath;
    }
    return gridPath ?? waypointPath ?? null;
  }

  private measurePathLength(path: Phaser.Math.Vector2[]) {
    if (path.length <= 1) return 0;
    let dist = 0;
    for (let i = 1; i < path.length; i += 1) {
      dist += Phaser.Math.Distance.Between(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y);
    }
    return dist;
  }

  private followAutoPath(body: Phaser.Physics.Arcade.Body) {
    const arrivalThreshold = 8;
    while (this.autoPathIndex < this.autoPath.length) {
      const target = this.autoPath[this.autoPathIndex];
      const toTarget = new Phaser.Math.Vector2(target.x - this.player.x, target.y - this.player.y);
      const distance = toTarget.length();
      if (distance <= arrivalThreshold) {
        this.autoPathIndex += 1;
        continue;
      }

      const direction = toTarget.normalize();
      body.setVelocity(direction.x * this.velocity, direction.y * this.velocity);
      const targetAngle = toTarget.angle();
      this.player.rotation = Phaser.Math.Angle.RotateTo(this.player.rotation, targetAngle, this.autoTurnRate);
      return;
    }

    body.setVelocity(0, 0);
    this.stopAutoMove();
  }

  private buildGridPath(start: GridPoint, target: GridPoint): Phaser.Math.Vector2[] | null {
    let pathTiles: GridPoint[] | null = null;
    if (this.isWalkable(target.x, target.y)) {
      pathTiles = this.findPath(start, target);
    }

    if (!pathTiles || pathTiles.length === 0) {
      pathTiles = this.searchNearestReachable(start, target);
    }

    if (pathTiles && pathTiles.length > 0) {
      const worldPath = this.toWorldPath(pathTiles);
      return worldPath.length > 0 ? worldPath : null;
    }
    return null;
  }

  private buildWaypointPath(start: GridPoint, target: GridPoint): Phaser.Math.Vector2[] | null {
    if (!this.navGrid || this.waypoints.size === 0) return null;

    const startWorld = this.gridToWorld(start);
    const targetWorld = this.gridToWorld(target);
    const startNode = this.findNearestWaypoint(startWorld);
    const targetNode = this.findNearestWaypoint(targetWorld);
    if (!startNode || !targetNode) return null;

    const nodePathIds = this.findWaypointGraphPath(startNode.id, targetNode.id);
    if (!nodePathIds) return null;
    const nodePath = nodePathIds
      .map((id) => this.waypoints.get(id))
      .filter((n): n is WaypointNode => Boolean(n));
    if (nodePath.length === 0) return null;

    const path: Phaser.Math.Vector2[] = [];
    const pushUnique = (pt: Phaser.Math.Vector2) => {
      const last = path[path.length - 1];
      if (!last || Phaser.Math.Distance.Between(last.x, last.y, pt.x, pt.y) > 1) {
        path.push(pt.clone());
      }
    };

    const startSeg = this.buildGridPath(start, this.worldToGrid(startNode.pos.x, startNode.pos.y));
    if (!startSeg) return null;
    startSeg.forEach((p) => pushUnique(p));

    nodePath.forEach((node) => pushUnique(node.pos));

    const endSeg = this.buildGridPath(this.worldToGrid(targetNode.pos.x, targetNode.pos.y), target);
    if (!endSeg) return null;
    endSeg.forEach((p, idx) => {
      if (idx === 0) {
        pushUnique(p);
      } else {
        pushUnique(p);
      }
    });

    return path.length > 0 ? path : null;
  }

  private loadWaypoints() {
    if (this.waypointsLoaded || !this.chunkManager) return;
    const chunk = this.chunkManager.getPrimaryChunk();
    if (!chunk) return;
    const layer = chunk.map.getObjectLayer('waypoints');
    if (!layer) {
      this.waypointsLoaded = true;
      return;
    }

    layer.objects.forEach((obj) => {
      const id = String(obj.name ?? obj.id ?? `${obj.x},${obj.y}`);
      const x = (obj.x ?? 0) + this.navOrigin.x;
      const y = (obj.y ?? 0) + this.navOrigin.y;
      const linksProp = this.findProperty(obj, 'links');
      const links = typeof linksProp === 'string' ? linksProp.split(',').map((v) => v.trim()).filter(Boolean) : [];
      this.waypoints.set(id, { id, pos: new Phaser.Math.Vector2(x, y), neighbors: new Set(links) });
    });

    // Auto-connect nodes that have no explicit links to their nearest neighbors within a reasonable radius.
    const nodes = Array.from(this.waypoints.values());
    nodes.forEach((node) => {
      if (node.neighbors.size > 0) return;
      const nearest = nodes
        .filter((n) => n.id !== node.id)
        .map((n) => ({ n, dist: Phaser.Math.Distance.Between(n.pos.x, n.pos.y, node.pos.x, node.pos.y) }))
        .sort((a, b) => a.dist - b.dist)
        .filter((a) => a.dist <= 360)
        .slice(0, 4);
      nearest.forEach(({ n }) => node.neighbors.add(n.id));
    });

    // Ensure links are bidirectional where possible.
    nodes.forEach((node) => {
      node.neighbors.forEach((neighborId) => {
        const neighbor = this.waypoints.get(neighborId);
        if (neighbor) {
          neighbor.neighbors.add(node.id);
        }
      });
    });

    this.waypointsLoaded = true;
  }

  private findNearestWaypoint(pos: Phaser.Math.Vector2, maxDistance = 600): WaypointNode | null {
    let closest: WaypointNode | null = null;
    let best = Number.MAX_VALUE;
    this.waypoints.forEach((node) => {
      const dist = Phaser.Math.Distance.Between(pos.x, pos.y, node.pos.x, node.pos.y);
      if (dist < best && dist <= maxDistance) {
        best = dist;
        closest = node;
      }
    });
    return closest;
  }

  private findWaypointGraphPath(startId: string, goalId: string): string[] | null {
    if (!this.waypoints.has(startId) || !this.waypoints.has(goalId)) return null;
    const openSet = new Set<string>([startId]);
    const cameFrom = new Map<string, string>();
    const gScore = new Map<string, number>([[startId, 0]]);
    const fScore = new Map<string, number>([[startId, this.waypointHeuristic(startId, goalId)]]);

    while (openSet.size > 0) {
      let current = '';
      let lowest = Number.MAX_VALUE;
      openSet.forEach((id) => {
        const score = fScore.get(id) ?? Number.MAX_VALUE;
        if (score < lowest) {
          lowest = score;
          current = id;
        }
      });

      if (current === goalId) {
        return this.reconstructWaypointPath(cameFrom, current);
      }

      openSet.delete(current);
      const node = this.waypoints.get(current);
      if (!node) continue;

      node.neighbors.forEach((neighborId) => {
        const neighbor = this.waypoints.get(neighborId);
        if (!neighbor) return;
        const tentativeG =
          (gScore.get(current) ?? Number.MAX_VALUE) +
          Phaser.Math.Distance.Between(node.pos.x, node.pos.y, neighbor.pos.x, neighbor.pos.y);
        const knownG = gScore.get(neighborId) ?? Number.MAX_VALUE;
        if (tentativeG < knownG) {
          cameFrom.set(neighborId, current);
          gScore.set(neighborId, tentativeG);
          fScore.set(neighborId, tentativeG + this.waypointHeuristic(neighborId, goalId));
          openSet.add(neighborId);
        }
      });
    }

    return null;
  }

  private waypointHeuristic(aId: string, bId: string) {
    const a = this.waypoints.get(aId);
    const b = this.waypoints.get(bId);
    if (!a || !b) return 0;
    return Phaser.Math.Distance.Between(a.pos.x, a.pos.y, b.pos.x, b.pos.y);
  }

  private reconstructWaypointPath(cameFrom: Map<string, string>, current: string): string[] {
    const path: string[] = [current];
    let cursor = current;
    while (cameFrom.has(cursor)) {
      cursor = cameFrom.get(cursor)!;
      path.push(cursor);
    }
    return path.reverse();
  }

  private buildNavigationGrid() {
    if (this.navGrid || !this.chunkManager) return;
    const chunk = this.chunkManager.getPrimaryChunk();
    if (!chunk) return;

    const offsetX = chunk.coord.x * this.chunkTileSize * this.tileSize;
    const offsetY = chunk.coord.y * this.chunkTileSize * this.tileSize;
    this.navOrigin.set(offsetX, offsetY);

    // Precompute walkable tiles from collision data so pathfinding stays fast.
    this.gridWidth = chunk.map.width;
    this.gridHeight = chunk.map.height;
    const grid: boolean[][] = Array.from({ length: this.gridHeight }, () =>
      Array.from({ length: this.gridWidth }, () => true)
    );

    chunk.collisionLayer?.forEachTile((tile) => {
      if (tile && tile.index >= 0 && tile.collides) {
        grid[tile.y][tile.x] = false;
      }
    });

    chunk.collisionObjects?.forEach((rect) => {
      const bounds = rect.getBounds();
      const minX = Phaser.Math.Clamp(
        Math.floor((bounds.left - offsetX) / this.tileSize),
        0,
        this.gridWidth - 1
      );
      const maxX = Phaser.Math.Clamp(
        Math.floor((bounds.right - 1 - offsetX) / this.tileSize),
        0,
        this.gridWidth - 1
      );
      const minY = Phaser.Math.Clamp(
        Math.floor((bounds.top - offsetY) / this.tileSize),
        0,
        this.gridHeight - 1
      );
      const maxY = Phaser.Math.Clamp(
        Math.floor((bounds.bottom - 1 - offsetY) / this.tileSize),
        0,
        this.gridHeight - 1
      );

      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          grid[y][x] = false;
        }
      }
    });

    this.navGrid = grid;
  }

  private isWalkable(x: number, y: number) {
    if (!this.navGrid) return false;
    if (x < 0 || y < 0 || x >= this.gridWidth || y >= this.gridHeight) return false;
    return this.navGrid[y]?.[x] ?? false;
  }

  private ensurePlayerSpawnValid() {
    if (!this.navGrid) return;
    const minX = this.navOrigin.x;
    const minY = this.navOrigin.y;
    const maxX = minX + this.gridWidth * this.tileSize;
    const maxY = minY + this.gridHeight * this.tileSize;
    const clampedX = Phaser.Math.Clamp(this.saveData.player.x, minX, maxX - 1);
    const clampedY = Phaser.Math.Clamp(this.saveData.player.y, minY, maxY - 1);
    let gridPos = this.worldToGrid(clampedX, clampedY);

    if (!this.isWalkable(gridPos.x, gridPos.y)) {
      const fallbackGrid =
        this.searchNearestWalkable(gridPos) ??
        this.searchNearestWalkable(this.worldToGrid((minX + maxX) / 2, (minY + maxY) / 2));
      if (fallbackGrid) {
        gridPos = fallbackGrid;
      }
    }

    const worldPos = this.gridToWorld(gridPos);
    this.player.setPosition(worldPos.x, worldPos.y);
    this.saveData.player = { x: worldPos.x, y: worldPos.y };
  }

  private worldToGrid(worldX: number, worldY: number): GridPoint {
    const localX = worldX - this.navOrigin.x;
    const localY = worldY - this.navOrigin.y;
    return {
      x: Phaser.Math.Clamp(Math.floor(localX / this.tileSize), 0, Math.max(this.gridWidth - 1, 0)),
      y: Phaser.Math.Clamp(Math.floor(localY / this.tileSize), 0, Math.max(this.gridHeight - 1, 0)),
    };
  }

  private getNavBounds() {
    if (!this.navGrid) return null;
    const minX = this.navOrigin.x;
    const minY = this.navOrigin.y;
    const maxX = minX + this.gridWidth * this.tileSize;
    const maxY = minY + this.gridHeight * this.tileSize;
    return { minX, minY, maxX, maxY };
  }

  private isInsideNavBounds(worldX: number, worldY: number, bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
    return worldX >= bounds.minX && worldX < bounds.maxX && worldY >= bounds.minY && worldY < bounds.maxY;
  }

  private syncWorldBoundsToNav() {
    const bounds = this.getNavBounds();
    if (!bounds) return;
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    this.physics.world.setBounds(bounds.minX, bounds.minY, width, height);
    this.player.body.setCollideWorldBounds(true);
  }

  private gridToWorld(point: GridPoint) {
    return new Phaser.Math.Vector2(
      point.x * this.tileSize + this.tileSize / 2 + this.navOrigin.x,
      point.y * this.tileSize + this.tileSize / 2 + this.navOrigin.y
    );
  }

  private getNeighbors(node: GridPoint): GridPoint[] {
    const axial = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    const diagonal = [
      { x: 1, y: 1 },
      { x: 1, y: -1 },
      { x: -1, y: 1 },
      { x: -1, y: -1 },
    ];

    const neighbors: GridPoint[] = [];
    for (const d of axial) {
      const nx = node.x + d.x;
      const ny = node.y + d.y;
      if (nx >= 0 && nx < this.gridWidth && ny >= 0 && ny < this.gridHeight) {
        neighbors.push({ x: nx, y: ny });
      }
    }

    for (const d of diagonal) {
      const nx = node.x + d.x;
      const ny = node.y + d.y;
      const withinBounds = nx >= 0 && nx < this.gridWidth && ny >= 0 && ny < this.gridHeight;
      if (!withinBounds) continue;
      // Prevent cutting corners through walls: both adjacent axial tiles must be walkable.
      const sideA = this.isWalkable(node.x, ny);
      const sideB = this.isWalkable(nx, node.y);
      if (sideA && sideB) {
        neighbors.push({ x: nx, y: ny });
      }
    }

    return neighbors;
  }

  private nodeKey(node: GridPoint) {
    return `${node.x},${node.y}`;
  }

  private decodeKey(key: string): GridPoint {
    const [x, y] = key.split(',').map((v) => Number(v));
    return { x, y };
  }

  private heuristic(a: GridPoint, b: GridPoint) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  private reconstructPath(cameFrom: Map<string, string>, currentKey: string): GridPoint[] {
    const path: GridPoint[] = [this.decodeKey(currentKey)];
    let cursor = currentKey;
    while (cameFrom.has(cursor)) {
      cursor = cameFrom.get(cursor)!;
      path.push(this.decodeKey(cursor));
    }
    return path.reverse();
  }

  private findPath(start: GridPoint, goal: GridPoint): GridPoint[] | null {
    if (!this.navGrid) return null;
    const startKey = this.nodeKey(start);
    const goalKey = this.nodeKey(goal);
    const openSet = new Set<string>([startKey]);
    const cameFrom = new Map<string, string>();
    const gScore = new Map<string, number>([[startKey, 0]]);
    const fScore = new Map<string, number>([[startKey, this.heuristic(start, goal)]]);

    while (openSet.size > 0) {
      let currentKey = '';
      let lowestF = Number.MAX_VALUE;
      openSet.forEach((key) => {
        const score = fScore.get(key) ?? Number.MAX_VALUE;
        if (score < lowestF) {
          lowestF = score;
          currentKey = key;
        }
      });

      if (currentKey === goalKey) {
        return this.reconstructPath(cameFrom, currentKey);
      }

      openSet.delete(currentKey);
      const current = this.decodeKey(currentKey);
      const currentG = gScore.get(currentKey) ?? Number.MAX_VALUE;

      for (const neighbor of this.getNeighbors(current)) {
        if (!this.isWalkable(neighbor.x, neighbor.y)) continue;
        const neighborKey = this.nodeKey(neighbor);
        const tentativeG = currentG + 1;
        if (tentativeG < (gScore.get(neighborKey) ?? Number.MAX_VALUE)) {
          cameFrom.set(neighborKey, currentKey);
          gScore.set(neighborKey, tentativeG);
          fScore.set(neighborKey, tentativeG + this.heuristic(neighbor, goal));
          openSet.add(neighborKey);
        }
      }
    }

    return null;
  }

  private searchNearestReachable(start: GridPoint, target: GridPoint): GridPoint[] | null {
    if (!this.navGrid) return null;
    const visited = new Set<string>();
    const queue: GridPoint[] = [target];
    const limit = this.gridWidth * this.gridHeight;

    while (queue.length > 0 && visited.size <= limit) {
      const current = queue.shift()!;
      const key = this.nodeKey(current);
      if (visited.has(key)) continue;
      visited.add(key);

      if (this.isWalkable(current.x, current.y)) {
        const path = this.findPath(start, current);
        if (path && path.length > 0) {
          return path;
        }
      }

      this.getNeighbors(current).forEach((neighbor) => {
        const neighborKey = this.nodeKey(neighbor);
        if (!visited.has(neighborKey)) {
          queue.push(neighbor);
        }
      });
    }

    return null;
  }

  private searchNearestWalkable(target: GridPoint): GridPoint | null {
    if (!this.navGrid) return null;
    const visited = new Set<string>();
    const queue: GridPoint[] = [target];
    const limit = this.gridWidth * this.gridHeight;
    while (queue.length > 0 && visited.size <= limit) {
      const current = queue.shift()!;
      const key = this.nodeKey(current);
      if (visited.has(key)) continue;
      visited.add(key);
      if (this.isWalkable(current.x, current.y)) return current;
      this.getNeighbors(current).forEach((neighbor) => {
        const neighborKey = this.nodeKey(neighbor);
        if (!visited.has(neighborKey)) queue.push(neighbor);
      });
    }
    return null;
  }

  private toWorldPath(path: GridPoint[]): Phaser.Math.Vector2[] {
    const worldPath = path.map((node) => this.gridToWorld(node));
    if (worldPath.length > 0) {
      const first = worldPath[0];
      const distanceToPlayer = Phaser.Math.Distance.Between(this.player.x, this.player.y, first.x, first.y);
      if (distanceToPlayer < 4) {
        worldPath.shift();
      }
    }
    return worldPath;
  }

  private isPointerOverUi(pointer: Phaser.Input.Pointer) {
    const uiElements = [
      this.langButton,
      this.musicButton,
      this.dialogText,
      this.interactionHint,
      this.debugButtons?.grid,
      this.debugButtons?.path,
      this.debugButtons?.log,
    ].filter((obj): obj is Phaser.GameObjects.Text => Boolean(obj && obj.visible));
    return uiElements.some((element) => {
      const bounds = element.getBounds();
      const usesScreenSpace = element.scrollFactorX === 0 && element.scrollFactorY === 0;
      const px = usesScreenSpace ? pointer.x : pointer.worldX;
      const py = usesScreenSpace ? pointer.y : pointer.worldY;
      return Phaser.Geom.Rectangle.Contains(bounds, px, py);
    });
  }

  private toggleDebug(kind: 'toggle' | 'grid' | 'path' | 'log') {
    if (kind === 'toggle') {
      const next = !this.debugFlags.enabled;
      this.debugFlags.enabled = next;
      this.debugFlags.grid = next;
      this.debugFlags.path = next;
      this.debugFlags.log = next;
    } else {
      this.debugFlags[kind] = !this.debugFlags[kind];
    }
    this.debugFlags.enabled = this.debugFlags.grid || this.debugFlags.path || this.debugFlags.log;
    this.debugDirty = true;
    this.drawDebugGrid();
    this.drawDebugPath();
    if (!this.debugFlags.grid && !this.debugFlags.path) {
      this.debugGraphics?.clear();
    }
    if (this.debugFlags.log) {
      console.log('[debug] flags', this.debugFlags);
    }
  }

  private togglePositionDebug() {
    this.positionDebugEnabled = !this.positionDebugEnabled;
    if (this.positionDebugEnabled) {
      this.ensurePositionDebugText();
      this.updatePositionDebug(true);
      this.positionDebugText?.setVisible(true);
    } else {
      this.positionDebugText?.setVisible(false);
    }
  }

  private refreshDebug() {
    if (!this.debugFlags.enabled || !this.debugDirty) return;
    if (this.debugFlags.grid) this.drawDebugGrid();
    if (this.debugFlags.path) this.drawDebugPath();
    this.debugDirty = false;
  }

  private drawDebugGrid() {
    if (!this.debugFlags.grid || !this.navGrid) return;
    const g = this.getDebugGraphics();
    g.clear();
    g.lineStyle(1, 0xffffff, 0.08);

    const reachable = this.collectReachableTiles();
    const dotColor = 0x44ff88;
    const dotAlpha = 0.5;
    const dotRadius = Math.max(2, Math.floor(this.tileSize / 6));

    for (let y = 0; y < this.gridHeight; y += 1) {
      for (let x = 0; x < this.gridWidth; x += 1) {
        const worldX = this.navOrigin.x + x * this.tileSize;
        const worldY = this.navOrigin.y + y * this.tileSize;
        if (this.navGrid[y][x] && reachable.has(`${x},${y}`)) {
          g.fillStyle(dotColor, dotAlpha);
          g.fillCircle(worldX + this.tileSize / 2, worldY + this.tileSize / 2, dotRadius);
        }
        g.strokeRect(worldX, worldY, this.tileSize, this.tileSize);
      }
    }

    const primary = this.chunkManager?.getPrimaryChunk();
    if (primary?.collisionObjects?.length) {
      const fillCol = 0xff8888;
      g.lineStyle(2, 0xff0000, 0.9);
      primary.collisionObjects.forEach((obj) => {
        const points = (obj as any).getData?.('polygon') as { x: number; y: number }[] | undefined;
        if (points && points.length >= 3) {
          g.fillStyle(fillCol, 0.28);
          g.fillPoints(points, true);
          g.beginPath();
          g.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i += 1) {
            g.lineTo(points[i].x, points[i].y);
          }
          g.closePath();
          g.strokePath();
        } else {
          const b = obj.getBounds();
          g.fillStyle(fillCol, 0.22);
          g.fillRect(b.x, b.y, b.width, b.height);
          g.strokeRect(b.x, b.y, b.width, b.height);
        }
      });
    }

    // Draw collision tiles (if any) as light red overlay for completeness.
    const collLayer = primary?.collisionLayer;
    if (collLayer) {
      g.fillStyle(0xff8888, 0.2);
      collLayer.forEachTile((tile) => {
        if (!tile || !tile.collides) return;
        const wx = tile.pixelX + this.navOrigin.x;
        const wy = tile.pixelY + this.navOrigin.y;
        g.fillRect(wx, wy, this.tileSize, this.tileSize);
        g.strokeRect(wx, wy, this.tileSize, this.tileSize);
      });
    }

    const navBounds = this.getNavBounds();
    if (navBounds) {
      g.lineStyle(3, 0xffaa00, 0.85);
      g.strokeRect(navBounds.minX, navBounds.minY, navBounds.maxX - navBounds.minX, navBounds.maxY - navBounds.minY);
    }

    if (this.debugFlags.path) {
      this.drawDebugPath();
    }
  }

  private drawDebugPath() {
    if (!this.debugFlags.path) return;
    const g = this.getDebugGraphics();
    if (!g) return;
    if (!this.debugFlags.grid) {
      g.clear();
    }
    g.lineStyle(2, 0x00b7ff, 0.9);
    g.fillStyle(0x00b7ff, 0.6);
    g.beginPath();
    this.autoPath.forEach((point, idx) => {
      if (idx === 0) {
        g.moveTo(point.x, point.y);
      } else {
        g.lineTo(point.x, point.y);
      }
      g.fillCircle(point.x, point.y, 3);
    });
    g.strokePath();
  }

  private positionDebugUi() {
    if (!this.debugButtons) return;
    const padding = 12;
    const width = this.scale.width;
    const baseX = Math.max(padding, width - 130);
    const baseY = padding;
    this.debugButtons.container.setPosition(baseX, baseY);
  }

  private registerResizeHandler() {
    this.resizeHandler = (gameSize: Phaser.Structs.Size) => {
      this.positionDebugUi();
      if (this.langButton) {
        // Keep other UI pinned after resize
        this.langButton.setPosition(12, gameSize.height - 80);
      }
      if (this.musicButton) {
        this.musicButton.setPosition(12, gameSize.height - 50);
      }
      if (this.positionDebugText) {
        this.positionDebugText.setPosition(gameSize.width / 2, gameSize.height / 2);
      }
      if (this.debugButtons) {
        this.debugButtons.container.list.forEach((obj) => {
          if ('setScrollFactor' in obj && typeof (obj as any).setScrollFactor === 'function') {
            (obj as any).setScrollFactor(0);
          }
        });
      }
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, this.resizeHandler);
    this.positionDebugUi();
  }

  private getDebugGraphics() {
    if (!this.debugGraphics) {
      this.debugGraphics = this.add.graphics();
      this.debugGraphics.setDepth(10);
    }
    return this.debugGraphics;
  }

  private collectReachableTiles() {
    const reachable = new Set<string>();
    if (!this.navGrid) return reachable;
    const start = this.worldToGrid(this.player.x, this.player.y);
    const queue: GridPoint[] = [start];
    const key = (p: GridPoint) => `${p.x},${p.y}`;
    const deltas = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];

    while (queue.length) {
      const node = queue.shift()!;
      const k = key(node);
      if (reachable.has(k)) continue;
      if (!this.isWalkable(node.x, node.y)) continue;
      reachable.add(k);
      for (const d of deltas) {
        const nx = node.x + d.x;
        const ny = node.y + d.y;
        if (this.isWalkable(nx, ny) && !reachable.has(`${nx},${ny}`)) {
          queue.push({ x: nx, y: ny });
        }
      }
    }

    return reachable;
  }

  private findProperty(obj: any, key: string) {
    const prop = (obj.properties ?? []).find((p: any) => p.name === key);
    return prop ? prop.value : '';
  }

  private createWorldObject(
    obj: Phaser.Types.Tilemaps.TiledObject,
    worldPosition: { x: number; y: number }
  ): Phaser.GameObjects.GameObject | null {
    if (obj.type === 'npc') {
      const npc = this.physics.add.sprite(
        worldPosition.x,
        worldPosition.y - (obj.height ?? 0),
        'npc'
      );
      npc.setInteractive({ useHandCursor: true });
      npc.setData('dialogKey', this.findProperty(obj, 'dialogKey'));
      npc.setData('dialog.en', this.findProperty(obj, 'dialog.en'));
      npc.setData('dialog.zh', this.findProperty(obj, 'dialog.zh'));
      npc.on('pointerdown', () => this.showDialog(npc));
      this.npcs.push(npc);
      return npc;
    }

    return null;
  }

  private showDialog(npc: Phaser.GameObjects.Sprite) {
    const dialogKey = npc.getData('dialogKey') as string;
    const dialogText =
      this.lang === 'zh'
        ? npc.getData('dialog.zh') || this.lookup(dialogKey)
        : npc.getData('dialog.en') || this.lookup(dialogKey);

    if (!this.dialogText) {
      this.dialogText = this.add.text(10, 10, dialogText, {
        color: '#ffffff',
        backgroundColor: '#000000aa',
        padding: { x: 8, y: 8 },
        wordWrap: { width: 320 },
      }).setScrollFactor(0);
    } else {
      this.dialogText.setText(dialogText);
    }

    if (!this.saveData.seenDialogs.includes(dialogKey)) {
      this.saveData.seenDialogs.push(dialogKey);
      this.persist();
    }

    this.activeDialogKey = dialogKey;
    this.activeDialogOverrides = {
      en: npc.getData('dialog.en'),
      zh: npc.getData('dialog.zh'),
    };
  }

  private lookup(path: string): string {
    const dict = this.dictionaries[this.lang];
    const value = path.split('.').reduce((obj, key) => (obj ? obj[key] : undefined), dict);
    if (typeof value === 'string') return value;
    if (value !== undefined && value !== null) return String(value);
    return path;
  }

  private createUI() {
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontSize: '16px',
      color: '#ffffff',
      backgroundColor: '#00000080',
      padding: { x: 8, y: 6 },
    };

    this.langButton = this.add.text(12, 520, '', style).setInteractive({ useHandCursor: true }).setScrollFactor(0);
    this.musicButton = this.add.text(12, 550, '', style).setInteractive({ useHandCursor: true }).setScrollFactor(0);

    this.interactionHint = this.add
      .text(0, 0, 'Press E / Tap to talk', {
        ...style,
        fontSize: '14px',
      })
      .setDepth(5)
      .setVisible(false);

    this.interactionHint.on('pointerdown', () => {
      if (this.nearbyNpc) {
        this.showDialog(this.nearbyNpc);
      }
    });

    this.langButton.on('pointerdown', () => {
      this.lang = this.lang === 'en' ? 'zh' : 'en';
      this.saveData.lang = this.lang;
      this.updateUiText();
      this.refreshDialogText();
      this.persist();
    });

    this.musicButton.on('pointerdown', () => {
      if (!this.bgm) {
        this.tryStartBgm(true);
        return;
      }
      const muted = this.bgm.volume <= 0;
      if (muted) {
        this.setVolume(this.lastVolume || 0.5);
      } else {
        this.lastVolume = this.bgm.volume;
        this.setVolume(0);
      }
    });
  }

  private createDebugUi() {
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontSize: '14px',
      color: '#ffe08a',
      backgroundColor: '#000000aa',
      padding: { x: 6, y: 4 },
    };
    const buttonGap = 4;
    const makeButton = (label: string, onClick: () => void) =>
      this.add
        .text(0, 0, label, style)
        .setInteractive({ useHandCursor: true })
        .setScrollFactor(0)
        .on('pointerdown', onClick);

    const gridBtn = makeButton('Debug Grid', () => this.toggleDebug('grid'));
    const pathBtn = makeButton('Debug Path', () => this.toggleDebug('path'));
    const logBtn = makeButton('Debug Log', () => this.toggleDebug('log'));
    pathBtn.setY(gridBtn.height + buttonGap);
    logBtn.setY((gridBtn.height + buttonGap) * 2);

    const container = this.add.container(0, 0, [gridBtn, pathBtn, logBtn]);
    container.setDepth(6);
    this.debugButtons = { container, grid: gridBtn, path: pathBtn, log: logBtn };
    this.positionDebugUi();
  }

  private ensurePositionDebugText() {
    if (this.positionDebugText) return;
    this.positionDebugText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, '', {
        fontSize: '18px',
        color: '#ffe08a',
        backgroundColor: '#000000c0',
        padding: { x: 12, y: 8 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(12);
  }

  private updatePositionDebug(force = false) {
    if (!this.positionDebugEnabled || !this.player) return;
    this.ensurePositionDebugText();
    const posText = `Player Position\nx: ${this.player.x.toFixed(1)}  y: ${this.player.y.toFixed(1)}`;
    if (force || this.positionDebugText?.text !== posText) {
      this.positionDebugText?.setText(posText);
    }
  }

  private updateUiText() {
    const dict = this.dictionaries[this.lang];
    const langLabel = dict?.ui?.language ?? 'Language';
    const musicLabel = dict?.ui?.music ?? 'Music';
    const mute = dict?.ui?.mute ?? 'Mute';
    const unmute = dict?.ui?.unmute ?? 'Unmute';

    if (this.langButton) {
      this.langButton.setText(`${langLabel}: ${this.lang === 'en' ? 'EN' : '中文'}`);
    }

    if (this.musicButton) {
      const volume = this.bgm ? this.bgm.volume : this.saveData.volume;
      const muted = volume <= 0;
      const volumeLabel = muted ? '' : ` (${Math.round(volume * 100)}%)`;
      this.musicButton.setText(`${musicLabel}: ${muted ? mute : `${unmute}${volumeLabel}`}`);
    }
  }

  private refreshDialogText() {
    if (!this.dialogText || !this.activeDialogKey) return;
    const override = this.activeDialogOverrides[this.lang];
    const dialogText = override || this.lookup(this.activeDialogKey);
    this.dialogText.setText(dialogText);
  }

  private setVolume(volume: number) {
    this.saveData.volume = volume;
    if (volume > 0) {
      this.lastVolume = volume;
    }
    if (this.bgm) {
      this.bgm.volume = volume;
      if (!this.bgm.isPlaying && volume > 0) {
        this.bgm.play({ loop: true, volume });
      }
      if (volume === 0 && this.bgm.isPlaying) {
        this.bgm.pause();
      } else if (volume > 0 && this.bgm.isPaused) {
        this.bgm.resume();
      }
    }
    this.persist();
    this.updateUiText();
  }

  private tryStartBgm(force = false) {
    if (!this.interacted && !force) return;
    if (this.bgmReady && this.bgm) {
      if (!this.bgm.isPlaying || force) {
        this.bgm.play({ loop: true, volume: this.saveData.volume });
      }
      return;
    }

    if (!this.sound.locked || force) {
      this.bgm = this.sound.add('bgm', { loop: true, volume: this.saveData.volume });
      this.bgm.play();
      this.bgmReady = true;
      this.updateUiText();
    } else {
      this.sound.once(Phaser.Sound.Events.UNLOCKED, () => this.tryStartBgm(true));
    }
  }

  private updateNearbyNpc() {
    if (!this.interactionHint) return;

    const maxDistance = 64;
    let closestNpc: Phaser.GameObjects.Sprite | null = null;
    let closestDistance = Number.MAX_VALUE;

    this.npcs.forEach((npc) => {
      const distance = Phaser.Math.Distance.Between(npc.x, npc.y, this.player.x, this.player.y);
      if (distance < maxDistance && distance < closestDistance) {
        closestDistance = distance;
        closestNpc = npc;
      }
    });

    this.nearbyNpc = closestNpc;

    if (closestNpc) {
      const { x, y } = closestNpc;
      this.interactionHint.setPosition(x - this.interactionHint.width / 2, y - 50);
      this.interactionHint.setVisible(true);
      this.interactionHint.setScrollFactor(1);
      this.interactionHint.setInteractive({ useHandCursor: true });
    } else {
      this.interactionHint.setVisible(false);
      this.interactionHint.disableInteractive();
    }
  }

  private handleNpcInteraction() {
    if (!this.nearbyNpc || !this.interactionKeys) return;

    const shouldInteract = this.interactionKeys.some((key) => Phaser.Input.Keyboard.JustDown(key));
    if (shouldInteract) {
      this.showDialog(this.nearbyNpc);
    }
  }

  private handleInteraction() {
    this.interacted = true;
    this.tryStartBgm();
  }

  private persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.saveData));
  }
}
