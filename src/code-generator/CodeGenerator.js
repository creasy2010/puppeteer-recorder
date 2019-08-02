import domEvents from './dom-events-to-record';
import pptrActions from './pptr-actions';
import Block from './Block';

const importPuppeteer = `const puppeteer = require('puppeteer');\n`;

const header = `const browser = await puppeteer.launch()
const page = await browser.newPage()`;

const footer = `await browser.close()`;

const wrappedHeader = `(async () => {
  const browser = await puppeteer.launch()
  const page = await browser.newPage()\n`;

const wrappedFooter = `  await browser.close()
})()`;


const toRecordKeyCode=[
    /*删除*/
    "Tab",
    "Enter",
    /*上下左右*/
    "ArrowDown","ArrowUp","ArrowLeft" ,"ArrowRight",
    /*del*/
    "Delete"
]
export const defaults = {
  wrapAsync: true,
  headless: true,
  waitForNavigation: true,
  waitForSelectorOnClick: true,
  blankLinesBetweenBlocks: true,
  dataAttribute: '',
};

export default class CodeGenerator {
  constructor(options) {
    this._options = Object.assign(defaults, options);
    this._blocks = [];
    this._frame = 'page';
    this._frameId = 0;
    this._allFrames = {};
    this._screenshotCounter = 1;

    this._hasNavigation = false;
  }

  generate(events,network) {
    return (`
async function testCaseXXXX(page) :Promise<VoidFunc> {

  let clean = await openIntercepRequest(page,()=>neworkMock);
  async function TestCase () {
    ${this._parseEvents(events)} 
    await clean();
  }
  var neworkMock =${JSON.stringify(network)};
  return TestCase;
  }
    `
    );
  }

  _getHeader() {
    console.debug(this._options);
    let hdr = this._options.wrapAsync ? wrappedHeader : header;
    hdr = this._options.headless
      ? hdr
      : hdr.replace('launch()', 'launch({ headless: false })');
    return hdr;
  }

  _getFooter() {
    return this._options.wrapAsync ? wrappedFooter : footer;
  }

  _parseEvents(events) {
    console.debug(`generating code for ${events ? events.length : 0} events`);
    let result = '';

    if (!events) return result;

    for (let i = 0; i < events.length; i++) {
      const {
        action,
        selector,
        value,
        href,
        keyCode,
        tagName,
        frameId,
        frameUrl,
      } = events[i];

      // we need to keep a handle on what frames events originate from
      this._setFrames(frameId, frameUrl);



      switch (action) {
        case 'keydown':
          if (toRecordKeyCode.includes(value)) {
            // tab key
            this._blocks.push(this._handleKeyDown(selector, value));
          }
          break;
        case 'click':
          this._blocks.push(this._handleClick(selector, events[i].mark));
          break;
        case 'input':
          this._blocks.push(this._handleInput(selector, value));
          break;
        // case 'mouseover':
        //   this._blocks.push(this._handleMouseOver(selector, events));
        //   break;
        // case 'mouseout':
        //   this._blocks.push(this._handleMouseout(selector, events));
        //   break;
        case 'change':
          if (tagName === 'SELECT') {
            this._blocks.push(this._handleChange(selector, value));
          }
          break;
        case pptrActions.GOTO:
          this._blocks.push(this._handleGoto(href, frameId));
          break;
        case pptrActions.VIEWPORT:
          this._blocks.push(this._handleViewport(value.width, value.height));
          break;
        case pptrActions.NAVIGATION:
          this._blocks.push(this._handleWaitForNavigation());
          this._hasNavigation = true;
          break;
        case pptrActions.SCREENSHOT:
          this._blocks.push(this._handleScreenshot(value));
          break;
      }
    }

    if (this._hasNavigation && this._options.waitForNavigation) {
      console.debug('Adding navigationPromise declaration');
      const block = new Block(this._frameId, {
        type: pptrActions.NAVIGATION_PROMISE,
        value: 'const navigationPromise = page.waitForNavigation()',
      });
      this._blocks.unshift(block);
    }

    console.debug('post processing blocks:', this._blocks);
    this._postProcess();

    const indent = this._options.wrapAsync ? '  ' : '';
    const newLine = `\n`;

    for (let block of this._blocks) {
      const lines = block.getLines();
      for (let line of lines) {
        result += indent + line.value + newLine;
      }
    }

    return result;
  }

  _setFrames(frameId, frameUrl) {
    if (frameId && frameId !== 0) {
      this._frameId = frameId;
      this._frame = `frame_${frameId}`;
      this._allFrames[frameId] = frameUrl;
    } else {
      this._frameId = 0;
      this._frame = 'page';
    }
  }

  _postProcess() {
    // when events are recorded from different frames, we want to add a frame setter near the code that uses that frame
    if (Object.keys(this._allFrames).length > 0) {
      this._postProcessSetFrames();
    }

    if (this._options.blankLinesBetweenBlocks && this._blocks.length > 0) {
      this._postProcessAddBlankLines();
    }
  }

  _handleKeyDown(selector, keyCode) {
    const block = new Block(this._frameId);
    block.addLine({
      type: domEvents.KEYDOWN,
      value: `await ${this._frame}.keyboard.press('${keyCode}'); 
              await sleep(0.5*Speed)
      `,
    });
    return block;
  }

  _handleClick(selector,mark) {
    const block = new Block(this._frameId);
    if (this._options.waitForSelectorOnClick) {
      block.addLine({
        type: domEvents.CLICK,
        value: `log(\`[clicking]${mark} \`);
        await waitElementVisiable(page,'${selector}');`,
      });
    }
    block.addLine({
      type: domEvents.CLICK,
      value: `await ${this._frame}.click('${selector}'); 
      await sleep(1*Speed)`,
    });
    return block;
  }
  _handleInput(selector,value) {
    const block = new Block(this._frameId);
    if (this._options.waitForSelectorOnClick) {
      block.addLine({
        type: domEvents.INPUT,
        value: `await ${this._frame}.waitForSelector('${selector}')`,
      });
    }
    block.addLine({
      type: domEvents.INPUT,
      value: `await ${this._frame}.type('${selector}','${value}')`,
    });
    return block;
  }
  _handleMouseOver(selector) {
    const block = new Block(this._frameId);
    if (this._options.waitForSelectorOnClick) {
      block.addLine({
        type: domEvents.MOUSEOVER,
        value: `await ${this._frame}.waitForSelector('${selector}')`,
      });
    }
    block.addLine({
      type: domEvents.MOUSEOVER,
      value: `await ${this._frame}.mouseOver('${selector}')`,
    });
    return block;
  }
  _handleMouseout(selector) {
    const block = new Block(this._frameId);
    if (this._options.waitForSelectorOnClick) {
      block.addLine({
        type: domEvents.MOUSEOUT,
        value: `await ${this._frame}.waitForSelector('${selector}')`,
      });
    }
    block.addLine({
      type: domEvents.MOUSEOUT,
      value: `await ${this._frame}.mouseOut('${selector}')`,
    });
    return block;
  }
  _handleChange(selector, value) {
    return new Block(this._frameId, {
      type: domEvents.CHANGE,
      value: `await ${this._frame}.select('${selector}', '${value}')`,
    });
  }
  _handleGoto(href) {
    return new Block(this._frameId, {
      type: pptrActions.GOTO,
      value: `
      await page.evaluate(\`window.__testContext__.goto('${href}')\`)
      await sleep(2);
      `,
    });
  }

  _handleViewport(width, height) {
    return new Block(this._frameId, {
      type: pptrActions.VIEWPORT,
      value: `await ${this
        ._frame}.setViewport({ width: ${width}, height: ${height} })`,
    });
  }

  _handleScreenshot(options) {
    let block;

    if (options && options.x && options.y && options.width && options.height) {
      // remove the tailing 'px'
      for (let prop in options) {
        if (options.hasOwnProperty(prop) && options[prop].slice(-2) === 'px') {
          options[prop] = options[prop].substring(0, options[prop].length - 2);
        }
      }

      block = new Block(this._frameId, {
        type: pptrActions.SCREENSHOT,
        value: `await ${this._frame}.screenshot({ path: 'screenshot_${this
          ._screenshotCounter}.png', clip: { x: ${options.x}, y: ${options.y}, width: ${options.width}, height: ${options.height} } })`,
      });
    } else {
      block = new Block(this._frameId, {
        type: pptrActions.SCREENSHOT,
        value: `await ${this._frame}.screenshot({ path: 'screenshot_${this
          ._screenshotCounter}.png' })`,
      });
    }

    this._screenshotCounter++;
    return block;
  }

  _handleWaitForNavigation() {
    const block = new Block(this._frameId);
    if (this._options.waitForNavigation) {
      block.addLine({
        type: pptrActions.NAVIGATION,
        value: `await navigationPromise`,
      });
    }
    return block;
  }

  _postProcessSetFrames() {
    for (let [i, block] of this._blocks.entries()) {
      const lines = block.getLines();
      for (let line of lines) {
        if (
          line.frameId &&
          Object.keys(this._allFrames).includes(line.frameId.toString())
        ) {
          const declaration = `const frame_${line.frameId} = frames.find(f => f.url() === '${this
            ._allFrames[line.frameId]}')`;
          this._blocks[i].addLineToTop({
            type: pptrActions.FRAME_SET,
            value: declaration,
          });
          this._blocks[i].addLineToTop({
            type: pptrActions.FRAME_SET,
            value: 'let frames = await page.frames()',
          });
          delete this._allFrames[line.frameId];
          break;
        }
      }
    }
  }

  _postProcessAddBlankLines() {
    let i = 0;
    while (i <= this._blocks.length) {
      const blankLine = new Block();
      blankLine.addLine({type: null, value: ''});
      this._blocks.splice(i, 0, blankLine);
      i += 2;
    }
  }
}
