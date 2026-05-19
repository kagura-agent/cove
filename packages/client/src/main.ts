import Phaser from "phaser";

class HelloScene extends Phaser.Scene {
  constructor() {
    super({ key: "HelloScene" });
  }

  create() {
    const { width, height } = this.cameras.main;
    this.add
      .text(width / 2, height / 2, "Hello Cove 🏝️", {
        fontSize: "48px",
        color: "#ffffff",
        fontFamily: "sans-serif",
      })
      .setOrigin(0.5);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: "#1a1a2e",
  scene: [HelloScene],
  parent: document.body,
});
