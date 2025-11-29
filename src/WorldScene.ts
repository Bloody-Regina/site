import Phaser from 'phaser';
import ChunkManager from './world/chunkManager';

type LangKey = 'en' | 'zh';

type SaveData = {
  lang: LangKey;
  volume: number;
  player: { x: number; y: number };
  seenDialogs: string[];
};

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
  private pointerDirection: Phaser.Math.Vector2 | null = null;
  private interacted = false;
  private moveKeys?: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private lastVolume = 0.5;
  private activeDialogKey: string | null = null;
  private activeDialogOverrides: Partial<Record<LangKey, string>> = {};
  private chunkManager?: ChunkManager;
  private readonly tileSize = 32;
  private readonly chunkTileSize = 64;
  private readonly chunkViewDistance = 1;

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
    this.player.setSize(24, 32);
    this.player.setOffset(-12, -16);
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
      tilesetKey: 'tileset',
      tilesetName: 'main',
      viewDistance: this.chunkViewDistance,
      player: this.player,
      objectFactory: (obj, worldPosition) => this.createWorldObject(obj, worldPosition),
    });
    this.chunkManager.updateChunksAround(this.player.x, this.player.y);

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

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.pointerDirection = new Phaser.Math.Vector2(
        pointer.worldX - this.player.x,
        pointer.worldY - this.player.y
      ).normalize();
      this.handleInteraction();
    });
    this.input.on('pointerup', () => {
      this.pointerDirection = null;
    });

    keyboard.once('keydown', () => this.handleInteraction());

    this.createUI();
    this.updateUiText();
  }

  update() {
    if (!this.player || !this.cursors || !this.moveKeys) return;
    this.chunkManager?.updateChunksAround(this.player.x, this.player.y);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const velocity = new Phaser.Math.Vector2(0, 0);
    const keys = this.moveKeys;

    if (this.cursors.left?.isDown || keys.left.isDown) velocity.x = -1;
    else if (this.cursors.right?.isDown || keys.right.isDown) velocity.x = 1;

    if (this.cursors.up?.isDown || keys.up.isDown) velocity.y = -1;
    else if (this.cursors.down?.isDown || keys.down.isDown) velocity.y = 1;

    if (this.pointerDirection) {
      velocity.copy(this.pointerDirection);
    }

    velocity.normalize().scale(this.velocity);
    body.setVelocity(velocity.x, velocity.y);

    if (Math.abs(body.velocity.x) > 0 || Math.abs(body.velocity.y) > 0) {
      this.saveData.player = { x: this.player.x, y: this.player.y };
      this.persist();
    }
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

  private handleInteraction() {
    this.interacted = true;
    this.tryStartBgm();
  }

  private persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.saveData));
  }
}
