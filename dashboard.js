var blessed = require('blessed')
, contrib = require('blessed-contrib')

class CliDraw {
  constructor() {
    this.screen = null
    this.grid = null
    this.totalTable = null
    this.detailsTable = null

    this.initBlessed()
  }

  initBlessed() {
    this.screen = blessed.screen()
    this.grid = new contrib.grid({rows: 12, cols: 12, screen: this.screen})

    this.screen.key(['escape', 'q', 'C-c'], function(ch, key) {
      this.screen.destroy();
      return process.exit(0);
    });

    this.initSurface()
  }

  initSurface() {
    this.totalTable = this.grid.set(0, 0, 12, 2, contrib.table, {
      keys: true,
      fg: 'white',
      selectedFg: 'white',
      selectedBg: 'blue',
      interactive: false,
      label: 'Goldshell Miner Total',
      width: '100%',
      height: '100%',
      border: {
          type: "line",
          fg: "cyan"
        },
      columnSpacing: 2, //in chars
      columnWidth: [18, 10] /*in chars*/
    })

    this.detailsTable = this.grid.set(0, 2, 12, 10, contrib.table, {
      keys: true,
      fg: 'white',
      selectedFg: 'white',
      selectedBg: 'blue',
      interactive: true,
      label: 'Goldshell Miner Details',
      width: '100%',
      height: '100%',
      border: {
          type: "line",
          fg: "cyan"
        },
      columnSpacing: 2, //in chars
      columnWidth: [8, 18, 8, 8, 8, 8, 14, 14, 10, 10, 10, 16, 12] /*in chars*/
   })

   this.detailsTable.focus()
   this.screen.render()
  }

  updateTotalTable(headers, stats) {
    this.totalTable.setData({ headers: headers, data: stats})
    this.screen.render()
  }

  updateDetailsTable(headers, stats) {
    this.detailsTable.setData({ headers: headers, data: stats})
    this.screen.render()
  }
}

module.exports = CliDraw;
