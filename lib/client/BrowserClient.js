const puppeteer = require('puppeteer'); // Headless Browser
const Pbf = require('pbf'); // Decodes the Protobuf properly
const EventEmitter = require('events');
const Queue = require('queue');
const DATA_ENUMS = require('../data/enums.js');

function messageOptions(tag, obj, pbf) {
  if (tag === 1) obj.key = pbf.readString();
  else if (tag === 2) obj.value = pbf.readString();
}
function badgesOptions(tag, obj, pbf) {
  if (tag === 2) obj.value = pbf.readString();
}
function decoreOptions(tag, obj, pbf) {
  if (tag === 1) obj.value = pbf.readString();
}
function messageLayer(tag, obj, pbf) {
  if (tag === 1) obj.unknownInt = pbf.readVarint(true);
  else if (tag === 2) obj.identifier = pbf.readString();
  else if (tag === 3) obj.user = pbf.readString();
  else if (tag === 5) obj.content = pbf.readString();
  else if (tag === 6) obj.id = pbf.readVarint(true);
  else if (tag === 7) obj.chatType = pbf.readVarint(true);
  else if (tag === 8) obj.something = pbf.readVarint(true);
  else if (tag === 9) obj.anotherIdentifier = pbf.readString();
  else if (tag === 11) obj.iconURL = pbf.readString();
  else if (tag === 12) obj.accountName = pbf.readString();
  else if (tag === 13) {
    if (obj.badges === undefined) {
      obj.badges = [];
    }
    const data = pbf.readMessage(badgesOptions, {});
    obj.badges.push(data.value);
  } else if (tag === 14) {
    if (obj.decore === undefined) {
      obj.decore = [];
    }
    const data = pbf.readMessage(decoreOptions, {});
    obj.decore.push(data.value);
  } else if (tag === 20) {
    const data = pbf.readMessage(messageOptions, {});
    obj[data.key] = data.value;
  }
}

function baseLayer(tag, layer, pbf) {
  if (tag === 1) layer.id = pbf.readString();
  else if (tag === 2) layer.type = pbf.readVarint(true);
  else if (tag === 3) {
    if (layer.data === undefined) {
      layer.data = [];
    }
    layer.data.push(pbf.readMessage(messageLayer, {}));
  } else if (tag === 5) layer.ud1 = pbf.readVarint(true);
  else if (tag === 6) layer.ud2 = pbf.readVarint(true);
}

module.exports = class Client extends EventEmitter {
  constructor(settings) {
    super();
    this.headless = true;
    this.agent = 'Trovo Chatbot Client created by Bioblaze Payne';
    this.viewport = { width: 800, height: 600 };
    if (settings) {
      this.headless = settings.headless === undefined ? this.headless : settings.headless;
      this.agent = settings.agent === undefined ? this.agent : settings.agent;
      this.viewport = settings.viewport === undefined ? this.viewport : settings.viewport;
    }
    this.page = null;
    this.queue = new Queue({ autostart: true, concurrency: 1 });
    this.loggedin = false;
  }

  async newPage() {
    this.browser = await puppeteer.launch({
      headless: this.headless,
    });

    const page = await this.browser.newPage();
    return page;
  }

  async login(url, email, password) {
    this.page = await this.newPage();

    // console.log(this.page);
    // Setting User Agent
    if (this.agent) {
      await this.page.setUserAgent(this.agent);
    }
    // Setting the Viewport Size.
    await this.page.setViewport(this.viewport);

    // Opens the Website itself.
    await this.page.goto(url, {
      waitUntil: 'networkidle2',
    });

    // All Dialog's that popup from the website are auto declined, but a Emit for Dialog's message is triggered.
    this.page.on('dialog', async (dialog) => this.dialogResponse(dialog));

    // All Console Output is redirected too the Emit for Console.
    this.page.on('console', (msg) => this.consoleResponse(msg));
    this.page._client.on('Network.webSocketClosed', (data) => {
      // So far i have not figured out a way to identify which websocket has closed. which is annoying me.
      this.emit('wsClosed', data);
    });
    this.page._client.on('Network.webSocketCreated', (data) => {
      this.emit('wsCreated', data);
    });
    this.page._client.on('Network.webSocketFrameReceived', async (data) => {
      try {
        const json = JSON.parse(data.response.payloadData);
        this.handleJsonMessage(json);
      } catch (e) {
        this.decodeBinaryMessage(data.response.payloadData);
      }
    });

    if (email && email.length > 0) {
      // Wait for the Login Interface to exist.
      await this.page.waitFor(1500);

      // This clicks the Login Button.
      const loginXpath = 'div > nav > div.uinfo-wrapper.flex > button:nth-child(4)';
      await this.page.click(loginXpath);

      // This waits for the Login Window to Appear Correctly <3
      await this.page.waitFor(
        'div.login-box > div.content-box > div.content-left > div > div:nth-child(2) > div > input',
      );

      // Location of the Email Div you must click in order to trigger the Input box.
      const emailClickPath =
        'div.login-box > div.content-box > div.content-left > div > div:nth-child(2) > div.input-box.border-bottom > span';
      await this.page.click(emailClickPath);

      // Location of the Input box you will need to type the Email in.
      const emailPath =
        'div.login-box > div.content-box > div.content-left > div > div:nth-child(2) > div > input';
      await this.page.type(emailPath, email);

      // Location of the Passsword Div you must click in order to trigger the Input box.
      const passClickPath =
        'div.login-box > div.content-box > div.content-left > div > div:nth-child(4) > div.input-box.border-bottom > span';
      await this.page.click(passClickPath);

      // Location of the Input Box you will need to Type the Password in.
      const passPath =
        'div.login-box > div.content-box > div.content-left > div > div:nth-child(4) > div > input';
      await this.page.type(passPath, password);

      // Location of the Login Button
      const loginButtonPath = 'div.login-box > div.content-box > div.content-left > div > button';
      await this.page.click(loginButtonPath);

      this.loggedin = true;

      await this.page.waitFor(3000);
    }

    this.emit('ready');
  }

  sendMessage(message) {
    this.queue.push(() => {
      return this._sendMessage(message);
    });
  }

  async _sendMessage(message) {
    if (!this.loggedin) {
      console.log('You need to be logged in in order to send messages. :O');
    } else {
      /*
    These steps are used to Properly handle the Chat Window.
    */
      // Trigger the Chat Window to Open.
      const chatToggle = '#live-fullscreen > svg';
      await this.page.click(chatToggle);

      // Wait for the Chat Window to Finish Opening.
      await this.page.waitFor('.input-container .editor');

      // Click on the Chat Message Div to Trigger the Input Box to work.
      const inputBoxPath = '.input-container .input-box';
      await this.page.click(inputBoxPath);

      // Click on the Chat Message Input Box and type into it the Message we are going to be Sending.
      const inputPath = '.input-container .editor';
      await this.page.type(inputPath, message);

      // Click the Send Button, since yeah. You need todo this LoL
      const buttonPath = '.input-container button.primary';
      await this.page.click(buttonPath);

      // Click the Close Chat Window, to Reset the State to be used by this Command at a Later time.
      const closePath = 'svg.svg-icon.cursor-pointer.toggle-icon.hover-highlight';
      await this.page.click(closePath);
    }
  }

  async dialogResponse(dialog) {
    this.emit('dialogMessage', dialog.message());
    await dialog.dismiss();
  }

  consoleResponse(msg) {
    this.emit('consoleMessage', msg.text());
  }

  handleJsonMessage(json) {
    switch (json.type.toLowerCase()) {
      case 'data': {
        const name = Object.keys(json.payload.data)[0];
        const payload = json.payload.data[name];
        this.emit('jsonData', 'data', payload);
        break;
      }
      case 'message': {
        const payload = JSON.parse(json.data.message);
        this.emit('jsonData', 'message', payload);
        break;
      }
      default:
    }
  }

  decodeBinaryMessage(data) {
    const binary = Buffer.from(data, 'base64');
    const decodeStruct = {
      seq: binary.readUInt32BE(10),
      operation: binary.readUInt16BE(8),
      validator: {
        length: binary.length,
        binary: binary.readUInt32BE(0),
      },
      packet: binary.slice(binary.readUInt16BE(8) === 8 ? 18 : 22, binary.readUInt32BE(0)),
    };
    // operation = 3 is the Chat Operation we wanna work with. This could be ALOT of things to be honest, but the most common triggered thing is specifically the Chat Messages.
    // Will add more Documentation and Triggers for all Associated Operation Triggers that Trovo has, most of them are pretty simple... LoL
    this.handleBinaryMessage(decodeStruct);
  }

  handleBinaryMessage(decodeStruct) {
    if (decodeStruct.operation !== 3) return;
    const output = new Pbf(decodeStruct.packet).readFields(baseLayer, {});
    if (output) {
      if (!output.data) return;

      if (output.data.length > 1) {
        for (let i = 0; i < output.data.length; i++) {
          this.emitMessageBasedOnType(output.data[i]);
        }
      } else {
        if (!output.data[0]) return;
        this.emitMessageBasedOnType(output.data[0]);
      }
    }
  }

  emitMessageBasedOnType(op) {
    if (op.__history__ !== undefined) return;
    if (op.chatType !== undefined) {
      switch (op.chatType) {
        case DATA_ENUMS.CHAT_TYPES.WELCOME: // User Joined
          this.emit('chatEvent', 'userJoined', op);
          break;
        case DATA_ENUMS.CHAT_TYPES.FOLLOW: // User Followed
          this.emit('chatEvent', 'userFollowed', op);
          break;
        case DATA_ENUMS.CHAT_TYPES.SUBSCRIBE_CHANNEL: // User Subbed
          this.emit('chatEvent', 'userSubbed', op);
          break;
        case DATA_ENUMS.CHAT_TYPES.GIFT: // Gift
          const spelldata = JSON.parse(op.content);
          const spellenum = DATA_ENUMS.SPELLS[spelldata.id];
          const newdata = { ...spelldata, ...DATA_ENUMS.SPELL_DATA[spellenum] };
          op.content = newdata;
          this.emit('chatEvent', 'giftRecieved', op);
          break;
        default:
          this.emit('chatMessage', op);
      }
    } else {
      this.emit('chatMessage', op);
    }
  }
};
