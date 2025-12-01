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
    player: { x: 100, y: 100 },
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
  private gridWidth = 0;
  private gridHeight = 0;
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
    // Use a small hitbox to make navigation through narrow gaps easier.
    this.player.setSize(12, 16);
    this.player.setOffset(-6, -8);
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

    this.debugKeys.toggle.on('down', () => this.toggleDebug('toggle'));
    this.debugKeys.grid.on('down', () => this.toggleDebug('grid'));
    this.debugKeys.path.on('down', () => this.toggleDebug('path'));
    this.debugKeys.log.on('down', () => this.toggleDebug('log'));

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

    const start = this.worldToGrid(this.player.x, this.player.y);
    const target = this.worldToGrid(worldX, worldY);
    if (!this.isWalkable(start.x, start.y) && this.navGrid) {
      this.navGrid[start.y][start.x] = true;
    }

    let pathTiles: GridPoint[] | null = null;
    if (this.isWalkable(target.x, target.y)) {
      pathTiles = this.findPath(start, target);
    }

    if (!pathTiles || pathTiles.length === 0) {
      pathTiles = this.searchNearestReachable(start, target);
    }

    if (pathTiles && pathTiles.length > 0) {
      const worldPath = this.toWorldPath(pathTiles);
      if (worldPath.length > 0) {
        this.startAutoMove(worldPath);
      } else {
        this.stopAutoMove();
      }
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
        pathTiles: pathTiles?.length ?? 0,
        worldPath: this.autoPath.length,
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

  private followAutoPath(body: Phaser.Physics.Arcade.Body) {
    const arrivalThreshold = 6;
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

  private buildNavigationGrid() {
    if (this.navGrid || !this.chunkManager) return;
    const chunk = this.chunkManager.getPrimaryChunk();
    if (!chunk) return;

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
      const minX = Phaser.Math.Clamp(Math.floor(bounds.left / this.tileSize), 0, this.gridWidth - 1);
      const maxX = Phaser.Math.Clamp(Math.floor((bounds.right - 1) / this.tileSize), 0, this.gridWidth - 1);
      const minY = Phaser.Math.Clamp(Math.floor(bounds.top / this.tileSize), 0, this.gridHeight - 1);
      const maxY = Phaser.Math.Clamp(Math.floor((bounds.bottom - 1) / this.tileSize), 0, this.gridHeight - 1);

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
    const maxX = this.gridWidth * this.tileSize;
    const maxY = this.gridHeight * this.tileSize;
    const clampedX = Phaser.Math.Clamp(this.saveData.player.x, 0, maxX - 1);
    const clampedY = Phaser.Math.Clamp(this.saveData.player.y, 0, maxY - 1);
    let gridPos = this.worldToGrid(clampedX, clampedY);

    if (!this.isWalkable(gridPos.x, gridPos.y)) {
      const fallbackGrid = this.searchNearestWalkable(gridPos) ?? this.searchNearestWalkable(this.worldToGrid(maxX / 2, maxY / 2));
      if (fallbackGrid) {
        gridPos = fallbackGrid;
      }
    }

    const worldPos = this.gridToWorld(gridPos);
    this.player.setPosition(worldPos.x, worldPos.y);
    this.saveData.player = { x: worldPos.x, y: worldPos.y };
  }

  private worldToGrid(worldX: number, worldY: number): GridPoint {
    return {
      x: Phaser.Math.Clamp(Math.floor(worldX / this.tileSize), 0, Math.max(this.gridWidth - 1, 0)),
      y: Phaser.Math.Clamp(Math.floor(worldY / this.tileSize), 0, Math.max(this.gridHeight - 1, 0)),
    };
  }

  private gridToWorld(point: GridPoint) {
    return new Phaser.Math.Vector2(
      point.x * this.tileSize + this.tileSize / 2,
      point.y * this.tileSize + this.tileSize / 2
    );
  }

  private getNeighbors(node: GridPoint): GridPoint[] {
    const deltas = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    return deltas
      .map((d) => ({ x: node.x + d.x, y: node.y + d.y }))
      .filter((p) => p.x >= 0 && p.x < this.gridWidth && p.y >= 0 && p.y < this.gridHeight);
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
    this.debugDirty = true;
    this.drawDebugGrid();
    this.drawDebugPath();
    if (this.debugFlags.log) {
      console.log('[debug] flags', this.debugFlags);
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
    for (let y = 0; y < this.gridHeight; y += 1) {
      for (let x = 0; x < this.gridWidth; x += 1) {
        const worldX = x * this.tileSize;
        const worldY = y * this.tileSize;
        if (!this.navGrid[y][x]) {
          g.fillStyle(0xff4444, 0.35);
          g.fillRect(worldX, worldY, this.tileSize, this.tileSize);
        } else if (reachable.has(`${x},${y}`)) {
          g.fillStyle(0x44ff88, 0.2);
          g.fillRect(worldX, worldY, this.tileSize, this.tileSize);
        }
        g.strokeRect(worldX, worldY, this.tileSize, this.tileSize);
      }
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
