import Phaser from 'phaser';
import BootScene from './BootScene';
import PreloadScene from './PreloadScene';
import WorldScene from './WorldScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#0f172a',
  render: { pixelArt: true },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, PreloadScene, WorldScene],
};

export default new Phaser.Game(config);
