import Phaser from 'phaser';

export type ChunkCoord = { x: number; y: number };

export type ChunkManagerOptions = {
  tileSize: number;
  chunkTileSize: number;
  tilesetKey: string;
  tilesetName: string;
  viewDistance: number;
  player: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  objectFactory?: (
    objectData: Phaser.Types.Tilemaps.TiledObject,
    worldPosition: { x: number; y: number }
  ) => Phaser.GameObjects.GameObject | null;
};

export type LoadedChunk = {
  key: string;
  coord: ChunkCoord;
  map: Phaser.Tilemaps.Tilemap;
  groundLayer?: Phaser.Tilemaps.TilemapLayer;
  collisionLayer?: Phaser.Tilemaps.TilemapLayer;
  collider?: Phaser.Physics.Arcade.Collider;
  objects: Phaser.GameObjects.GameObject[];
};

export default class ChunkManager {
  private scene: Phaser.Scene;
  private options: ChunkManagerOptions;
  private loadedChunks = new Map<string, LoadedChunk>();
  private loadingPromises = new Map<string, Promise<LoadedChunk>>();
  private currentCenter: ChunkCoord | null = null;

  constructor(scene: Phaser.Scene, options: ChunkManagerOptions) {
    this.scene = scene;
    this.options = options;
  }

  get chunkPixelSize() {
    return this.options.tileSize * this.options.chunkTileSize;
  }

  updateChunksAround(worldX: number, worldY: number) {
    const center = this.getChunkCoord(worldX, worldY);
    if (this.currentCenter && center.x === this.currentCenter.x && center.y === this.currentCenter.y) {
      return;
    }

    this.currentCenter = center;
    const desired = this.collectDesiredChunks(center);
    desired.forEach((coord) => void this.ensureChunk(coord));
    this.cleanupChunks(desired);
    this.refreshWorldBounds();
  }

  private collectDesiredChunks(center: ChunkCoord) {
    const desired: ChunkCoord[] = [];
    for (let y = center.y - this.options.viewDistance; y <= center.y + this.options.viewDistance; y += 1) {
      for (let x = center.x - this.options.viewDistance; x <= center.x + this.options.viewDistance; x += 1) {
        desired.push({ x, y });
      }
    }
    return desired;
  }

  private getChunkCoord(worldX: number, worldY: number): ChunkCoord {
    const size = this.chunkPixelSize;
    return {
      x: Math.floor(worldX / size),
      y: Math.floor(worldY / size),
    };
  }

  private ensureChunk(coord: ChunkCoord): Promise<LoadedChunk> {
    const key = this.chunkKey(coord);
    const existing = this.loadedChunks.get(key);
    if (existing) return Promise.resolve(existing);

    const pending = this.loadingPromises.get(key);
    if (pending) return pending;

    const promise = new Promise<LoadedChunk>((resolve, reject) => {
      if (this.scene.cache.tilemap.exists(key)) {
        resolve(this.createChunk(coord));
        return;
      }

      this.scene.load.tilemapTiledJSON(key, `assets/maps/${key}.json`);
      const onError = (_file: unknown, fileKey: string) => {
        if (fileKey === key) {
          cleanup();
          reject(new Error(`Failed to load chunk: ${key}`));
        }
      };
      const onComplete = (loadedKey: string) => {
        if (loadedKey === key) {
          cleanup();
          resolve(this.createChunk(coord));
        }
      };

      const cleanup = () => {
        this.scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
        this.scene.load.off(`filecomplete-tilemapJSON-${key}`, onComplete);
        this.loadingPromises.delete(key);
      };

      this.scene.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
      this.scene.load.once(`filecomplete-tilemapJSON-${key}`, onComplete);
      if (!this.scene.load.isLoading()) {
        this.scene.load.start();
      }
    }).finally(() => {
      this.loadingPromises.delete(key);
    });

    this.loadingPromises.set(key, promise);
    return promise;
  }

  private createChunk(coord: ChunkCoord): LoadedChunk {
    const key = this.chunkKey(coord);
    const map = this.scene.make.tilemap({ key });
    const tileset = map.addTilesetImage(
      this.options.tilesetName,
      this.options.tilesetKey,
      this.options.tileSize,
      this.options.tileSize,
      0,
      0
    );
    if (!tileset) {
      throw new Error('Tileset failed to load for chunk');
    }

    const offsetX = coord.x * this.chunkPixelSize;
    const offsetY = coord.y * this.chunkPixelSize;

    const groundLayer = map.createLayer('ground', tileset, offsetX, offsetY) ?? undefined;
    const collisionLayer = map.createLayer('collision', tileset, offsetX, offsetY) ?? undefined;
    groundLayer?.setDepth(0);
    collisionLayer?.setDepth(1);
    collisionLayer?.setCollisionBetween(1, 1000);

    const collider = collisionLayer
      ? this.scene.physics.add.collider(this.options.player, collisionLayer)
      : undefined;

    const objects = this.buildObjects(map, offsetX, offsetY);

    const chunk: LoadedChunk = {
      key,
      coord,
      map,
      groundLayer,
      collisionLayer,
      collider,
      objects,
    };

    this.loadedChunks.set(key, chunk);
    return chunk;
  }

  private buildObjects(map: Phaser.Tilemaps.Tilemap, offsetX: number, offsetY: number) {
    const objects: Phaser.GameObjects.GameObject[] = [];
    const objectLayer = map.getObjectLayer('objects');
    if (!objectLayer || !this.options.objectFactory) return objects;

    objectLayer.objects.forEach((obj) => {
      const created = this.options.objectFactory!(obj, {
        x: (obj.x ?? 0) + offsetX,
        y: (obj.y ?? 0) + offsetY,
      });
      if (created) {
        objects.push(created);
      }
    });

    return objects;
  }

  private cleanupChunks(desired: ChunkCoord[]) {
    const desiredKeys = new Set(desired.map((coord) => this.chunkKey(coord)));
    Array.from(this.loadedChunks.keys())
      .filter((key) => !desiredKeys.has(key))
      .forEach((key) => this.unloadChunk(key));
  }

  private unloadChunk(key: string) {
    const chunk = this.loadedChunks.get(key);
    if (!chunk) return;

    chunk.collider?.destroy();
    chunk.collisionLayer?.destroy();
    chunk.groundLayer?.destroy();
    chunk.objects.forEach((obj) => obj.destroy());
    chunk.map.destroy();

    this.loadedChunks.delete(key);
  }

  private refreshWorldBounds() {
    if (!this.currentCenter) return;
    const size = this.chunkPixelSize;
    const range = this.options.viewDistance;
    const minX = (this.currentCenter.x - range) * size;
    const minY = (this.currentCenter.y - range) * size;
    const width = size * (range * 2 + 1);
    const height = size * (range * 2 + 1);
    this.scene.physics.world.setBounds(minX, minY, width, height);
  }

  private chunkKey(coord: ChunkCoord) {
    return `chunk_${coord.x}_${coord.y}`;
  }
}
