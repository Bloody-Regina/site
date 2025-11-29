import Phaser from 'phaser';

export default class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create() {
    this.cameras.main.setBackgroundColor('#1b1f2f');
    this.scale.scaleMode = Phaser.Scale.ScaleModes.FIT;
    this.scale.autoCenter = Phaser.Scale.CENTER_BOTH;
    this.scale.refresh();
    this.scene.start('PreloadScene');
  }
}
