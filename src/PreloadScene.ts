import Phaser from 'phaser';
import BGM_DATA_URI from './generatedAudio.txt?raw';

export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super('PreloadScene');
  }

  preload() {
    this.load.tilemapTiledJSON('chunk_0_0', 'assets/maps/chunk_0_0.json');
    this.load.audio('bgm', [BGM_DATA_URI]);
    this.load.json('i18n-en', 'i18n/en.json');
    this.load.json('i18n-zh', 'i18n/zh.json');
  }

  create() {
    this.createTilesetTexture();
    this.createNpcTexture();
    this.scene.start('WorldScene');
  }

  private createTilesetTexture() {
    const size = 32;
    const cols = 4;
    const rows = 4;
    const canvas = this.textures.createCanvas('tileset', size * cols, size * rows);
    if (!canvas) return;

    const ctx = canvas.getContext();
    const colors = [
      '#4a90e2',
      '#50e3c2',
      '#f5a623',
      '#f8e71c',
      '#bd10e0',
      '#9013fe',
      '#7ed321',
      '#417505',
      '#b8e986',
      '#d0011b',
      '#8b572a',
      '#9b9b9b',
      '#7f8c8d',
      '#34495e',
      '#2ecc71',
      '#c0392b',
    ];

    if (!ctx) return;

    let index = 0;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        ctx.fillStyle = colors[index % colors.length];
        ctx.fillRect(x * size, y * size, size, size);
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 2;
        ctx.strokeRect(x * size, y * size, size, size);
        index += 1;
      }
    }

    canvas.refresh();
  }

  private createNpcTexture() {
    const width = 32;
    const height = 48;
    const canvas = this.textures.createCanvas('npc', width, height);
    if (!canvas) return;

    const ctx = canvas.getContext();

    if (!ctx) return;

    ctx.fillStyle = '#f0c674';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#222';
    ctx.fillRect(8, 8, 16, 12);
    ctx.fillRect(6, 22, 20, 18);
    ctx.fillStyle = '#fff';
    ctx.fillRect(10, 12, 4, 4);
    ctx.fillRect(18, 12, 4, 4);

    canvas.refresh();
  }
}
