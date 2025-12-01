import Phaser from 'phaser';

export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super('PreloadScene');
  }

  preload() {
    this.load.tilemapTiledJSON('Liyue_city', 'assets/maps/Liyue_city.json');
    this.load.image('Full_Liyue', 'assets/tiles/Full_Liyue.png');
    this.load.audio('bgm', 'assets/audio/串烧.mp3');
    this.load.json('i18n-en', 'i18n/en.json');
    this.load.json('i18n-zh', 'i18n/zh.json');
  }

  create() {
    this.createNpcTexture();
    this.scene.start('WorldScene');
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
