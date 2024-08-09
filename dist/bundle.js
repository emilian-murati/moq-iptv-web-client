/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./node_modules/@mengelbart/moqjs/src/control_stream.ts":
/*!**************************************************************!*\
  !*** ./node_modules/@mengelbart/moqjs/src/control_stream.ts ***!
  \**************************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ControlStream = void 0;
const messages_1 = __webpack_require__(/*! ./messages */ "./node_modules/@mengelbart/moqjs/src/messages.ts");
class ControlStream {
    constructor(r, w) {
        this.reader = r;
        this.writer = w;
    }
    async handshake() {
        const writer = this.writer.getWriter();
        await writer.write(new messages_1.ClientSetupEncoder({
            type: messages_1.MessageType.ClientSetup,
            versions: [messages_1.CURRENT_SUPPORTED_DRAFT],
            parameters: [
                new messages_1.ParameterEncoder({ type: 0, value: new Uint8Array([0x2]) }),
            ],
        }));
        writer.releaseLock();
        const reader = this.reader.getReader();
        const { value, done } = await reader.read();
        if (done) {
            throw new Error("control stream closed");
        }
        if (value.type != messages_1.MessageType.ServerSetup) {
            throw new Error("invalid first message on control stream");
        }
        // TODO: Evaluate server setup message?
        reader.releaseLock();
    }
    async runReadLoop() {
        const reader = this.reader.getReader();
        for (;;) {
            const { value, done } = await reader.read();
            if (done) {
                console.log("control stream closed");
                break;
            }
            if (this.onmessage) {
                this.onmessage(value);
            }
        }
    }
    async send(m) {
        const writer = this.writer.getWriter();
        await writer.write(m);
        writer.releaseLock();
    }
}
exports.ControlStream = ControlStream;


/***/ }),

/***/ "./node_modules/@mengelbart/moqjs/src/decoder.ts":
/*!*******************************************************!*\
  !*** ./node_modules/@mengelbart/moqjs/src/decoder.ts ***!
  \*******************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ObjectStreamDecoder = exports.ControlStreamDecoder = void 0;
const messages_1 = __webpack_require__(/*! ./messages */ "./node_modules/@mengelbart/moqjs/src/messages.ts");
var EncoderState;
(function (EncoderState) {
    EncoderState[EncoderState["Init"] = 0] = "Init";
    EncoderState[EncoderState["TrackStream"] = 1] = "TrackStream";
    EncoderState[EncoderState["GroupStream"] = 2] = "GroupStream";
})(EncoderState || (EncoderState = {}));
class Decoder {
    constructor(stream) {
        this.reader = stream;
        this.buffer = new Uint8Array(8);
    }
    async read(buffer, offset, length) {
        const reader = this.reader.getReader({ mode: "byob" });
        while (offset < length) {
            const buf = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, length - offset);
            const { value, done } = await reader.read(buf);
            if (done) {
                throw new Error("stream closed");
            }
            buffer = new Uint8Array(value.buffer, value.byteOffset - offset);
            offset += value.byteLength;
        }
        reader.releaseLock();
        return buffer;
    }
    async readN(n) {
        const buffer = new Uint8Array(n);
        const data = await this.read(buffer, 0, n);
        return data;
    }
    async readAll() {
        const reader = this.reader.getReader();
        let buffer = new Uint8Array();
        for (;;) {
            const { value, done } = await reader.read();
            if (done) {
                break;
            }
            const next = new Uint8Array(buffer.byteLength + value.byteLength);
            next.set(buffer);
            next.set(value, buffer.byteLength);
            buffer = next;
        }
        reader.releaseLock();
        return buffer;
    }
    async readVarint() {
        this.buffer = await this.read(this.buffer, 0, 1);
        if (this.buffer.length !== 1) {
            throw new Error("readVarint could not read first byte");
        }
        const prefix = this.buffer[0] >> 6;
        const length = 1 << prefix;
        let view = new DataView(this.buffer.buffer, 0, length);
        switch (length) {
            case 1:
                return view.getUint8(0) & 0x3f;
            case 2:
                this.buffer = await this.read(this.buffer, 1, 2);
                view = new DataView(this.buffer.buffer, 0, length);
                return view.getUint16(0) & 0x3fff;
            case 4:
                this.buffer = await this.read(this.buffer, 1, 4);
                view = new DataView(this.buffer.buffer, 0, length);
                return view.getUint32(0) & 0x3fffffff;
            case 8:
                this.buffer = await this.read(this.buffer, 1, 8);
                view = new DataView(this.buffer.buffer, 0, length);
                return view.getBigUint64(0) & 0x3fffffffffffffffn;
        }
        throw new Error("invalid varint length");
    }
    async objectStream() {
        return {
            type: messages_1.MessageType.ObjectStream,
            subscribeId: await this.readVarint(),
            trackAlias: await this.readVarint(),
            groupId: await this.readVarint(),
            objectId: await this.readVarint(),
            publisherPriority: (await this.readN(1))[0],
            objectStatus: await this.readVarint(),
            objectPayload: await this.readAll(),
        };
    }
    async subscribe() {
        const subscribeId = await this.readVarint();
        const trackAlias = await this.readVarint();
        const trackNamespace = await this.string();
        const trackName = await this.string();
        const subscriberPriority = (await this.readN(1))[0];
        const groupOrder = (await this.readN(1))[0];
        const filterType = await this.readVarint();
        let startGroup;
        let startObject;
        let endGroup;
        let endObject;
        if (filterType === messages_1.FilterType.AbsoluteStart ||
            filterType == messages_1.FilterType.AbsoluteRange) {
            startGroup = await this.readVarint();
            startObject = await this.readVarint();
        }
        if (filterType == messages_1.FilterType.AbsoluteRange) {
            endGroup = await this.readVarint();
            endObject = await this.readVarint();
        }
        return {
            type: messages_1.MessageType.Subscribe,
            subscribeId,
            trackAlias,
            trackNamespace,
            trackName,
            subscriberPriority,
            groupOrder,
            filterType,
            startGroup,
            startObject,
            endGroup,
            endObject,
            subscribeParameters: await this.parameters(),
        };
    }
    async subscribeUpdate() {
        const subscribeId = await this.readVarint();
        const startGroup = await this.readVarint();
        const startObject = await this.readVarint();
        const endGroup = await this.readVarint();
        const endObject = await this.readVarint();
        const subscriberPriority = (await this.readN(1))[0];
        return {
            type: messages_1.MessageType.SubscribeUpdate,
            subscribeId,
            startGroup,
            startObject,
            endGroup,
            endObject,
            subscriberPriority,
            subscribeParameters: await this.parameters(),
        };
    }
    async subscribeOk() {
        const subscribeId = await this.readVarint();
        const expires = await this.readVarint();
        const groupOrder = (await this.readN(1))[0];
        const contentExists = (await this.readVarint()) == 1;
        let finalGroup;
        let finalObject;
        if (contentExists) {
            finalGroup = await this.readVarint();
            finalObject = await this.readVarint();
        }
        return {
            type: messages_1.MessageType.SubscribeOk,
            subscribeId,
            expires,
            groupOrder,
            contentExists,
            finalGroup,
            finalObject,
        };
    }
    async subscribeError() {
        return {
            type: messages_1.MessageType.SubscribeError,
            subscribeId: await this.readVarint(),
            errorCode: await this.readVarint(),
            reasonPhrase: await this.string(),
            trackAlias: await this.readVarint(),
        };
    }
    async announce() {
        return {
            type: messages_1.MessageType.Announce,
            namespace: await this.string(),
            parameters: await this.parameters(),
        };
    }
    async announceOk() {
        return {
            type: messages_1.MessageType.AnnounceOk,
            trackNamespace: await this.string(),
        };
    }
    async announceError() {
        return {
            type: messages_1.MessageType.AnnounceError,
            trackNamespace: await this.string(),
            errorCode: await this.readVarint(),
            reasonPhrase: await this.string(),
        };
    }
    async unannounce() {
        return {
            type: messages_1.MessageType.Unannounce,
            trackNamespace: await this.string(),
        };
    }
    async unsubscribe() {
        return {
            type: messages_1.MessageType.Unsubscribe,
            subscribeId: await this.readVarint(),
        };
    }
    async subscribeDone() {
        const subscribeId = await this.readVarint();
        const statusCode = await this.readVarint();
        const reasonPhrase = await this.string();
        const contentExists = (await this.readVarint()) == 1;
        let finalGroup;
        let finalObject;
        if (contentExists) {
            finalGroup = await this.readVarint();
            finalObject = await this.readVarint();
        }
        return {
            type: messages_1.MessageType.SubscribeDone,
            subscribeId,
            statusCode,
            reasonPhrase,
            contentExists,
            finalGroup,
            finalObject,
        };
    }
    async goAway() {
        return {
            type: messages_1.MessageType.GoAway,
            newSessionURI: await this.string(),
        };
    }
    async serverSetup() {
        return {
            type: messages_1.MessageType.ServerSetup,
            selectedVersion: await this.readVarint(),
            parameters: await this.parameters(),
        };
    }
    async streamHeaderTrack() {
        return {
            type: messages_1.MessageType.StreamHeaderTrack,
            subscribeId: await this.readVarint(),
            trackAlias: await this.readVarint(),
            publisherPriority: (await this.readN(1))[0],
        };
    }
    async streamHeaderTrackObject() {
        const groupId = await this.readVarint();
        const objectId = await this.readVarint();
        const length = await this.readVarint();
        if (length > Number.MAX_VALUE) {
            throw new Error(`cannot read more then ${Number.MAX_VALUE} bytes from stream`);
        }
        let objectStatus;
        if (length === 0) {
            objectStatus = await this.readVarint();
        }
        return {
            groupId,
            objectId,
            objectStatus,
            objectPayload: await this.readN(length),
        };
    }
    async streamHeaderGroup() {
        return {
            type: messages_1.MessageType.StreamHeaderGroup,
            subscribeId: await this.readVarint(),
            trackAlias: await this.readVarint(),
            groupId: await this.readVarint(),
            publisherPriority: (await this.readN(1))[0],
        };
    }
    async streamHeaderGroupObject() {
        let objectId;
        try {
            // stream can be closed if the peer is done sending all objects
            objectId = await this.readVarint();
        }
        catch (err) {
            return null;
        }
        const length = await this.readVarint();
        if (length > Number.MAX_VALUE) {
            throw new Error(`cannot read more then ${Number.MAX_VALUE} bytes from stream`);
        }
        let objectStatus;
        if (length === 0) {
            objectStatus = await this.readVarint();
        }
        return {
            objectId: objectId,
            objectStatus,
            objectPayload: await this.readN(length),
        };
    }
    async string() {
        const length = await this.readVarint();
        if (length > Number.MAX_VALUE) {
            throw new Error(`cannot read more then ${Number.MAX_VALUE} bytes from stream`);
        }
        const data = await this.readN(length);
        return new TextDecoder().decode(data);
    }
    async parameter() {
        const type = await this.readVarint();
        const length = await this.readVarint();
        if (length > Number.MAX_VALUE) {
            throw new Error(`cannot read more then ${Number.MAX_VALUE} bytes from stream`);
        }
        return {
            type: type,
            value: await this.readN(length),
        };
    }
    async parameters() {
        const num = await this.readVarint();
        const parameters = [];
        for (let i = 0; i < num; i++) {
            parameters.push(await this.parameter());
        }
        return parameters;
    }
}
class ControlStreamDecoder extends Decoder {
    async pull(controller) {
        const mt = await this.readVarint();
        switch (mt) {
            case messages_1.MessageType.Subscribe:
                return controller.enqueue(await this.subscribe());
            case messages_1.MessageType.SubscribeUpdate:
                return controller.enqueue(await this.subscribeUpdate());
            case messages_1.MessageType.SubscribeOk:
                return controller.enqueue(await this.subscribeOk());
            case messages_1.MessageType.SubscribeError:
                return controller.enqueue(await this.subscribeError());
            case messages_1.MessageType.Announce:
                return controller.enqueue(await this.announce());
            case messages_1.MessageType.AnnounceOk:
                return controller.enqueue(await this.announceOk());
            case messages_1.MessageType.AnnounceError:
                return controller.enqueue(await this.announceError());
            case messages_1.MessageType.Unannounce:
                return controller.enqueue(await this.unannounce());
            case messages_1.MessageType.Unsubscribe:
                return controller.enqueue(await this.unsubscribe());
            case messages_1.MessageType.SubscribeDone:
                return controller.enqueue(await this.subscribeDone());
            case messages_1.MessageType.GoAway:
                return controller.enqueue(await this.goAway());
            case messages_1.MessageType.ServerSetup:
                return controller.enqueue(await this.serverSetup());
        }
        throw new Error(`unexpected message type: ${mt}`);
    }
}
exports.ControlStreamDecoder = ControlStreamDecoder;
class ObjectStreamDecoder extends Decoder {
    constructor(stream) {
        super(stream);
        this.state = EncoderState.Init;
    }
    async pull(controller) {
        if (this.state === EncoderState.TrackStream) {
            const o = await this.streamHeaderTrackObject();
            return controller.enqueue({
                type: messages_1.MessageType.StreamHeaderTrack,
                subscribeId: this.subscribeId,
                trackAlias: this.trackAlias,
                groupId: o.groupId,
                objectId: o.objectId,
                publisherPriority: this.publisherPriority,
                objectStatus: 0,
                objectPayload: o.objectPayload,
            });
        }
        if (this.state === EncoderState.GroupStream) {
            const o = await this.streamHeaderGroupObject();
            if (!o) {
                controller.close();
                return;
            }
            return controller.enqueue({
                type: messages_1.MessageType.StreamHeaderGroup,
                subscribeId: this.subscribeId,
                trackAlias: this.trackAlias,
                groupId: this.groupId,
                objectId: o.objectId,
                publisherPriority: this.publisherPriority,
                objectStatus: 0,
                objectPayload: o.objectPayload,
            });
        }
        const mt = await this.readVarint();
        console.log("decoding message type", mt);
        if (mt === messages_1.MessageType.ObjectStream) {
            controller.enqueue(await this.objectStream());
            return controller.close();
        }
        if (mt === messages_1.MessageType.StreamHeaderTrack) {
            const header = await this.streamHeaderTrack();
            this.state = EncoderState.TrackStream;
            this.subscribeId = header.subscribeId;
            this.trackAlias = header.trackAlias;
            this.publisherPriority = header.publisherPriority;
            const o = await this.streamHeaderTrackObject();
            return controller.enqueue({
                type: messages_1.MessageType.StreamHeaderTrack,
                subscribeId: this.subscribeId,
                trackAlias: this.trackAlias,
                groupId: o.groupId,
                objectId: o.objectId,
                publisherPriority: this.publisherPriority,
                objectStatus: 0,
                objectPayload: o.objectPayload,
            });
        }
        if (mt === messages_1.MessageType.StreamHeaderGroup) {
            const header = await this.streamHeaderGroup();
            this.state = EncoderState.GroupStream;
            this.subscribeId = header.subscribeId;
            this.trackAlias = header.trackAlias;
            this.groupId = header.groupId;
            this.publisherPriority = header.publisherPriority;
            const o = await this.streamHeaderGroupObject();
            if (!o) {
                return;
            }
            return controller.enqueue({
                type: messages_1.MessageType.StreamHeaderGroup,
                subscribeId: this.subscribeId,
                trackAlias: this.trackAlias,
                groupId: this.groupId,
                objectId: o.objectId,
                publisherPriority: this.publisherPriority,
                objectStatus: 0,
                objectPayload: o.objectPayload,
            });
        }
        throw new Error(`unexpected message type: ${mt}`);
    }
}
exports.ObjectStreamDecoder = ObjectStreamDecoder;


/***/ }),

/***/ "./node_modules/@mengelbart/moqjs/src/encoder.ts":
/*!*******************************************************!*\
  !*** ./node_modules/@mengelbart/moqjs/src/encoder.ts ***!
  \*******************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Encoder = void 0;
const varint_1 = __webpack_require__(/*! ./varint */ "./node_modules/@mengelbart/moqjs/src/varint.ts");
class Encoder {
    constructor(stream) {
        this.writer = stream;
    }
    async write(chunk, _) {
        await chunk.encode(this);
    }
    async writeVarint(i) {
        const data = (0, varint_1.encodeVarint)(i);
        const writer = this.writer.getWriter();
        await writer.write(data);
        writer.releaseLock();
    }
    async writeBytes(data) {
        const writer = this.writer.getWriter();
        await writer.write(data);
        writer.releaseLock();
    }
    async writeString(s) {
        const data = new TextEncoder().encode(s);
        await this.writeVarint(data.byteLength);
        await this.writeBytes(data);
    }
}
exports.Encoder = Encoder;


/***/ }),

/***/ "./node_modules/@mengelbart/moqjs/src/index.ts":
/*!*****************************************************!*\
  !*** ./node_modules/@mengelbart/moqjs/src/index.ts ***!
  \*****************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Session = void 0;
var session_1 = __webpack_require__(/*! ./session */ "./node_modules/@mengelbart/moqjs/src/session.ts");
Object.defineProperty(exports, "Session", ({ enumerable: true, get: function () { return session_1.Session; } }));


/***/ }),

/***/ "./node_modules/@mengelbart/moqjs/src/messages.ts":
/*!********************************************************!*\
  !*** ./node_modules/@mengelbart/moqjs/src/messages.ts ***!
  \********************************************************/
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ParameterEncoder = exports.StreamHeaderGroupObjectEncoder = exports.StreamHeaderGroupEncoder = exports.StreamHeaderTrackObjectEncoder = exports.StreamHeaderTrackEncoder = exports.ServerSetupEncoder = exports.ClientSetupEncoder = exports.GoAwayEncoder = exports.UnannounceEncoder = exports.AnnounceErrorEncoder = exports.AnnounceOkEncoder = exports.AnnounceEncoder = exports.SubscribeDoneEncoder = exports.UnsubscribeEncoder = exports.SubscribeErrorEncoder = exports.SubscribeOkEncoder = exports.SubscribeUpdateEncoder = exports.SubscribeEncoder = exports.FilterType = exports.ObjectStreamEncoder = exports.MessageType = exports.CURRENT_SUPPORTED_DRAFT = exports.DRAFT_IETF_MOQ_TRANSPORT_05 = exports.DRAFT_IETF_MOQ_TRANSPORT_04 = exports.DRAFT_IETF_MOQ_TRANSPORT_03 = exports.DRAFT_IETF_MOQ_TRANSPORT_02 = exports.DRAFT_IETF_MOQ_TRANSPORT_01 = void 0;
exports.DRAFT_IETF_MOQ_TRANSPORT_01 = 0xff000001;
exports.DRAFT_IETF_MOQ_TRANSPORT_02 = 0xff000002;
exports.DRAFT_IETF_MOQ_TRANSPORT_03 = 0xff000003;
exports.DRAFT_IETF_MOQ_TRANSPORT_04 = 0xff000004;
exports.DRAFT_IETF_MOQ_TRANSPORT_05 = 0xff000005;
exports.CURRENT_SUPPORTED_DRAFT = exports.DRAFT_IETF_MOQ_TRANSPORT_03;
var MessageType;
(function (MessageType) {
    MessageType[MessageType["ObjectStream"] = 0] = "ObjectStream";
    MessageType[MessageType["ObjectDatagram"] = 1] = "ObjectDatagram";
    MessageType[MessageType["SubscribeUpdate"] = 2] = "SubscribeUpdate";
    MessageType[MessageType["Subscribe"] = 3] = "Subscribe";
    MessageType[MessageType["SubscribeOk"] = 4] = "SubscribeOk";
    MessageType[MessageType["SubscribeError"] = 5] = "SubscribeError";
    MessageType[MessageType["Announce"] = 6] = "Announce";
    MessageType[MessageType["AnnounceOk"] = 7] = "AnnounceOk";
    MessageType[MessageType["AnnounceError"] = 8] = "AnnounceError";
    MessageType[MessageType["Unannounce"] = 9] = "Unannounce";
    MessageType[MessageType["Unsubscribe"] = 10] = "Unsubscribe";
    MessageType[MessageType["SubscribeDone"] = 11] = "SubscribeDone";
    MessageType[MessageType["AnnounceCancel"] = 12] = "AnnounceCancel";
    MessageType[MessageType["GoAway"] = 16] = "GoAway";
    MessageType[MessageType["ClientSetup"] = 64] = "ClientSetup";
    MessageType[MessageType["ServerSetup"] = 65] = "ServerSetup";
    MessageType[MessageType["StreamHeaderTrack"] = 80] = "StreamHeaderTrack";
    MessageType[MessageType["StreamHeaderGroup"] = 81] = "StreamHeaderGroup";
})(MessageType || (exports.MessageType = MessageType = {}));
class ObjectStreamEncoder {
    constructor(m) {
        Object.assign(this, m);
    }
    async encode(e) {
        if (this.type === MessageType.ObjectStream || this.type === MessageType.ObjectDatagram) {
            await e.writeVarint(this.type);
            await e.writeVarint(this.subscribeId);
            await e.writeVarint(this.trackAlias);
            await e.writeVarint(this.groupId);
            await e.writeVarint(this.objectId);
            await e.writeBytes(new Uint8Array([this.publisherPriority]));
            await e.writeVarint(this.objectStatus);
            await e.writeBytes(this.objectPayload);
            return;
        }
        if (this.type === MessageType.StreamHeaderTrack) {
            await e.writeVarint(this.groupId);
            await e.writeVarint(this.objectId);
            await e.writeVarint(this.objectPayload.length);
            if (this.objectPayload.length === 0) {
                await e.writeVarint(this.objectStatus);
                return;
            }
            await e.writeBytes(this.objectPayload);
            return;
        }
        if (this.type === MessageType.StreamHeaderGroup) {
            await e.writeVarint(this.objectId);
            await e.writeVarint(this.objectPayload.length);
            if (this.objectPayload.length === 0) {
                await e.writeVarint(this.objectStatus);
                return;
            }
            await e.writeBytes(this.objectPayload);
            return;
        }
        throw new Error(`cannot encode unknown message type ${this.type}`);
    }
}
exports.ObjectStreamEncoder = ObjectStreamEncoder;
var FilterType;
(function (FilterType) {
    FilterType[FilterType["LatestGroup"] = 1] = "LatestGroup";
    FilterType[FilterType["LatestObject"] = 2] = "LatestObject";
    FilterType[FilterType["AbsoluteStart"] = 3] = "AbsoluteStart";
    FilterType[FilterType["AbsoluteRange"] = 4] = "AbsoluteRange";
})(FilterType || (exports.FilterType = FilterType = {}));
class SubscribeEncoder {
    constructor(m) {
        Object.assign(this, m);
    }
    async encode(e) {
        await e.writeVarint(this.type);
        await e.writeVarint(this.subscribeId);
        await e.writeVarint(this.trackAlias);
        await e.writeString(this.trackNamespace);
        await e.writeString(this.trackName);
        await e.writeBytes(new Uint8Array([this.subscriberPriority]));
        await e.writeBytes(new Uint8Array([this.groupOrder]));
        await e.writeVarint(this.filterType);
        if (this.filterType === FilterType.AbsoluteStart ||
            this.filterType === FilterType.AbsoluteRange) {
            await e.writeVarint(this.startGroup || 0);
            await e.writeVarint(this.startObject || 0);
        }
        if (this.filterType === FilterType.AbsoluteRange) {
            await e.writeVarint(this.endGroup || 0);
            await e.writeVarint(this.endObject || 0);
        }
        await e.writeVarint(this.subscribeParameters.length);
        for (const p of this.subscribeParameters) {
            await new ParameterEncoder(p).encode(e);
        }
    }
}
exports.SubscribeEncoder = SubscribeEncoder;
class SubscribeUpdateEncoder {
    constructor(m) {
        Object.assign(this, m);
    }
    async encode(e) {
        await e.writeVarint(this.type);
        await e.writeVarint(this.subscribeId);
        await e.writeVarint(this.startGroup);
        await e.writeVarint(this.startObject);
        await e.writeVarint(this.endGroup);
        await e.writeVarint(this.endObject);
        await e.writeBytes(new Uint8Array([this.subscriberPriority]));
        await e.writeVarint(this.subscribeParameters.length);
        for (const p of this.subscribeParameters) {
            await new ParameterEncoder(p).encode(e);
        }
    }
}
exports.SubscribeUpdateEncoder = SubscribeUpdateEncoder;
class SubscribeOkEncoder {
    constructor(m) {
        Object.assign(this, m);
    }
    async encode(e) {
        await e.writeVarint(this.type);
        await e.writeVarint(this.subscribeId);
        await e.writeVarint(this.expires);
        await e.writeBytes(new Uint8Array([this.groupOrder]));
        await e.writeVarint(this.contentExists ? 1 : 0); // TODO: Should use byte instead of varint?
        if (this.contentExists) {
            await e.writeVarint(this.finalGroup);
            await e.writeVarint(this.finalObject);
        }
    }
}
exports.SubscribeOkEncoder = SubscribeOkEncoder;
class SubscribeErrorEncoder {
    constructor(m) {
        Object.assign(this, m);
    }
    async encode(e) {
        await e.writeVarint(this.type);
        await e.writeVarint(this.subscribeId);
        await e.writeVarint(this.errorCode);
        await e.writeString(this.reasonPhrase);
        await e.writeVarint(this.trackAlias);
    }
}
exports.SubscribeErrorEncoder = SubscribeErrorEncoder;
class UnsubscribeEncoder {
    constructor(m) {
        Object.assign(this, m);
    }
    async encode(e) {
        await e.writeVarint(this.type);
        await e.writeVarint(this.subscribeId);
    }
}
exports.UnsubscribeEncoder = UnsubscribeEncoder;
class SubscribeDoneEncoder {
    constructor(m) {
        Object.assign(this, m);
    }
    async encode(e) {
        await e.writeVarint(this.type);
        await e.writeVarint(this.subscribeId);
        await e.writeVarint(this.statusCode);
        await e.writeString(this.reasonPhrase);
        await e.writeVarint(this.contentExists ? 1 : 0); // TODO: Should use byte instead of varint?
        if (this.contentExists) {
            await e.writeVarint(this.finalGroup || 0);
            await e.writeVarint(this.finalObject || 0);
        }
    }
}
exports.SubscribeDoneEncoder = SubscribeDoneEncoder;
class AnnounceEncoder {
    constructor(m) {
        Object.assign(this, m);
    }
    async encode(e) {
        await e.writeVarint(this.type);
        await e.writeString(this.namespace);
        await e.writeVarint(this.parameters.length);
        for (const p of this.parameters) {
            await new ParameterEncoder(p).encode(e);
        }
    }
}
exports.AnnounceEncoder = AnnounceEncoder;
class AnnounceOkEncoder {
    constructor(m) {
        Object.assign(this, m);
    }
    async encode(e) {
        await e.writeVarint(this.type);
        await e.writeString(this.trackNamespace);
    }
}
exports.AnnounceOkEncoder = AnnounceOkEncoder;
class AnnounceErrorEncoder {
    constructor(m) {
        Object.assign(this, m);
    }
    async encode(e) {
        await e.writeVarint(this.type);
        await e.writeString(this.trackNamespace);
        await e.writeVarint(this.errorCode);
        await e.writeString(this.reasonPhrase);
    }
}
exports.AnnounceErrorEncoder = AnnounceErrorEncoder;
class UnannounceEncoder {
    constructor(m) {
        Object.assign(this, m);
    }
    async encode(e) {
        await e.writeVarint(this.type);
        await e.writeString(this.trackNamespace);
    }
}
exports.UnannounceEncoder = UnannounceEncoder;
class GoAwayEncoder {
    constructor(m) {
        Object.assign(this, m);
    }
    async encode(e) {
        await e.writeVarint(this.type);
        await e.writeString(this.newSessionURI);
    }
}
exports.GoAwayEncoder = GoAwayEncoder;
class ClientSetupEncoder {
    constructor(cs) {
        Object.assign(this, cs);
    }
    async encode(e) {
        await e.writeVarint(this.type);
        await e.writeVarint(this.versions.length);
        for (const v of this.versions) {
            await e.writeVarint(v);
        }
        await e.writeVarint(this.parameters.length);
        for (const p of this.parameters) {
            await new ParameterEncoder(p).encode(e);
        }
    }
}
exports.ClientSetupEncoder = ClientSetupEncoder;
class ServerSetupEncoder {
    constructor(m) {
        Object.assign(this, m);
    }
}
exports.ServerSetupEncoder = ServerSetupEncoder;
class StreamHeaderTrackEncoder {
    constructor(m) {
        Object.assign(this, m);
    }
    async encode(e) {
        await e.writeVarint(this.type);
        await e.writeVarint(this.subscribeId);
        await e.writeVarint(this.trackAlias);
        await e.writeBytes(new Uint8Array([this.publisherPriority]));
    }
}
exports.StreamHeaderTrackEncoder = StreamHeaderTrackEncoder;
class StreamHeaderTrackObjectEncoder {
    constructor(m) {
        Object.assign(this, m);
    }
    async encode(e) {
        await e.writeVarint(this.groupId);
        await e.writeVarint(this.objectId);
        await e.writeVarint(this.objectPayload.byteLength);
        if (this.objectPayload.byteLength === 0) {
            await e.writeVarint(this.objectStatus || 0);
        }
        else {
            await e.writeBytes(this.objectPayload);
        }
    }
}
exports.StreamHeaderTrackObjectEncoder = StreamHeaderTrackObjectEncoder;
class StreamHeaderGroupEncoder {
    constructor(m) {
        Object.assign(this, m);
    }
    async encode(e) {
        await e.writeVarint(this.type);
        await e.writeVarint(this.subscribeId);
        await e.writeVarint(this.trackAlias);
        await e.writeVarint(this.groupId);
        await e.writeBytes(new Uint8Array([this.publisherPriority]));
    }
}
exports.StreamHeaderGroupEncoder = StreamHeaderGroupEncoder;
class StreamHeaderGroupObjectEncoder {
    constructor(m) {
        Object.assign(this, m);
    }
    async encode(e) {
        await e.writeVarint(this.objectId);
        await e.writeVarint(this.objectPayload.byteLength);
        if (this.objectPayload.byteLength === 0) {
            await e.writeVarint(this.objectStatus || 0);
        }
        else {
            await e.writeBytes(this.objectPayload);
        }
    }
}
exports.StreamHeaderGroupObjectEncoder = StreamHeaderGroupObjectEncoder;
class ParameterEncoder {
    constructor(p) {
        Object.assign(this, p);
    }
    async encode(e) {
        await e.writeVarint(this.type);
        await e.writeVarint(this.value.byteLength);
        await e.writeBytes(this.value);
    }
}
exports.ParameterEncoder = ParameterEncoder;


/***/ }),

/***/ "./node_modules/@mengelbart/moqjs/src/session.ts":
/*!*******************************************************!*\
  !*** ./node_modules/@mengelbart/moqjs/src/session.ts ***!
  \*******************************************************/
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Session = void 0;
const control_stream_1 = __webpack_require__(/*! ./control_stream */ "./node_modules/@mengelbart/moqjs/src/control_stream.ts");
const decoder_1 = __webpack_require__(/*! ./decoder */ "./node_modules/@mengelbart/moqjs/src/decoder.ts");
const encoder_1 = __webpack_require__(/*! ./encoder */ "./node_modules/@mengelbart/moqjs/src/encoder.ts");
const messages_1 = __webpack_require__(/*! ./messages */ "./node_modules/@mengelbart/moqjs/src/messages.ts");
const subscription_1 = __webpack_require__(/*! ./subscription */ "./node_modules/@mengelbart/moqjs/src/subscription.ts");
function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}
class Session {
    constructor(conn, cs) {
        this.nextSubscribeId = 0;
        this.subscriptions = new Map();
        this.conn = conn;
        this.controlStream = cs;
        cs.onmessage = this.handle.bind(this);
        this.controlStream.runReadLoop();
        this.readIncomingUnidirectionalStreams(this.conn);
    }
    static async connect(url, serverCertificateHash) {
        console.log("connecting WebTransport");
        let conn;
        try {
            if (serverCertificateHash !== undefined) {
                const certHashes = [
                    {
                        algorithm: "sha-256",
                        value: base64ToArrayBuffer(serverCertificateHash),
                    },
                ];
                console.log("hashes", certHashes);
                console.log("url", url);
                conn = new WebTransport(url, { serverCertificateHashes: certHashes });
            }
            else {
                console.log("connecting without serverCertificateHashes");
                conn = new WebTransport(url);
            }
        }
        catch (error) {
            throw new Error(`failed to connect MoQ session: ${error}`);
        }
        await conn.ready;
        console.log("WebTransport connection ready");
        const cs = await conn.createBidirectionalStream();
        const decoderStream = new ReadableStream(new decoder_1.ControlStreamDecoder(cs.readable));
        const encoderStream = new WritableStream(new encoder_1.Encoder(cs.writable));
        const controlStream = new control_stream_1.ControlStream(decoderStream, encoderStream);
        await controlStream.handshake();
        console.log("handshake done");
        return new Session(conn, controlStream);
    }
    async readIncomingUnidirectionalStreams(conn) {
        console.log("reading incoming streams");
        const uds = conn.incomingUnidirectionalStreams;
        const reader = uds.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            this.readIncomingUniStream(value);
        }
    }
    // @ts-ignore
    async readIncomingUniStream(stream) {
        console.log("got stream");
        const messageStream = new ReadableStream(new decoder_1.ObjectStreamDecoder(stream));
        const reader = messageStream.getReader();
        for (;;) {
            const { value, done } = await reader.read();
            if (done) {
                console.log("stream closed");
                break;
            }
            // console.log("got object", value);
            if (!this.subscriptions.has(value.subscribeId)) {
                throw new Error(`got object for unknown subscribeId: ${value.subscribeId}`);
            }
            // console.log(
            //   "writing to subscription",
            //   this.subscriptions.get(value.subscribeId)
            // );
            const writer = this.subscriptions
                .get(value.subscribeId)
                .subscription.writable.getWriter();
            await writer.write(value);
            writer.releaseLock();
        }
    }
    async handle(m) {
        switch (m.type) {
            case messages_1.MessageType.SubscribeOk:
                this.subscriptions.get(m.subscribeId)?.subscribeOk();
        }
    }
    async subscribe(namespace, track) {
        const subId = this.nextSubscribeId++;
        const s = new subscription_1.Subscription(subId);
        this.subscriptions.set(subId, s);
        await this.controlStream.send(new messages_1.SubscribeEncoder({
            type: messages_1.MessageType.Subscribe,
            subscribeId: subId,
            trackAlias: subId,
            trackNamespace: namespace,
            trackName: track,
            subscriberPriority: 0,
            groupOrder: 1,
            filterType: messages_1.FilterType.LatestGroup,
            subscribeParameters: [],
        }));
        const readableStream = await s.getReadableStream();
        return {
            subscribeId: subId,
            readableStream,
        };
    }
    async unsubscribe(subscribeId) {
        this.controlStream.send(new messages_1.UnsubscribeEncoder({
            type: messages_1.MessageType.Unsubscribe,
            subscribeId: subscribeId,
        }));
    }
}
exports.Session = Session;


/***/ }),

/***/ "./node_modules/@mengelbart/moqjs/src/subscription.ts":
/*!************************************************************!*\
  !*** ./node_modules/@mengelbart/moqjs/src/subscription.ts ***!
  \************************************************************/
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Subscription = void 0;
class Subscription {
    constructor(id) {
        this.id = id;
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
        this.subscription = new TransformStream({
            transform: (chunk, controller) => {
                controller.enqueue(chunk.objectPayload);
            },
        });
    }
    subscribeOk() {
        this.resolve(this.subscription.readable);
    }
    subscribeError(reason) {
        this.reject(reason);
    }
    getReadableStream() {
        return this.promise;
    }
}
exports.Subscription = Subscription;


/***/ }),

/***/ "./node_modules/@mengelbart/moqjs/src/varint.ts":
/*!******************************************************!*\
  !*** ./node_modules/@mengelbart/moqjs/src/varint.ts ***!
  \******************************************************/
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.MAX_VAR_INT_8 = exports.MAX_VAR_INT_4 = exports.MAX_VAR_INT_2 = exports.MAX_VAR_INT_1 = void 0;
exports.encodeVarint = encodeVarint;
exports.MAX_VAR_INT_1 = 63;
exports.MAX_VAR_INT_2 = 16383;
exports.MAX_VAR_INT_4 = 1073741823;
exports.MAX_VAR_INT_8 = 4611686018427387903n;
function encodeVarint(chunk) {
    if (chunk <= exports.MAX_VAR_INT_1) {
        const data = new Uint8Array(1);
        const view = new DataView(data.buffer);
        view.setUint8(0, chunk);
        return data;
    }
    else if (chunk <= exports.MAX_VAR_INT_2) {
        const data = new Uint8Array(2);
        const view = new DataView(data.buffer);
        view.setUint16(0, chunk | 0x4000);
        return data;
    }
    else if (chunk <= exports.MAX_VAR_INT_4) {
        const data = new Uint8Array(4);
        const view = new DataView(data.buffer);
        view.setUint32(0, chunk | 0x80000000);
        return data;
    }
    else if (chunk <= exports.MAX_VAR_INT_8) {
        const data = new Uint8Array(8);
        const view = new DataView(data.buffer);
        view.setBigUint64(0, BigInt(chunk) | 0xc000000000000000n, false);
        return data;
    }
    throw new Error("value too large for varint encoding");
}


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it uses a non-standard name for the exports (exports).
(() => {
var exports = __webpack_exports__;
/*!**********************!*\
  !*** ./src/index.ts ***!
  \**********************/

Object.defineProperty(exports, "__esModule", ({ value: true }));
const src_1 = __webpack_require__(/*! @mengelbart/moqjs/src */ "./node_modules/@mengelbart/moqjs/src/index.ts");
async function main() {
    const videoPlayer = document.getElementById('videoPlayer');
    const serverUrl = 'https://localhost:8080/moq';
    async function parseM3U(url) {
        const response = await fetch(url);
        const data = await response.text();
        const lines = data.split('\n');
        const channels = [];
        let currentName = '';
        for (const line of lines) {
            if (line.startsWith('#EXTINF:')) {
                currentName = line.split(',')[1].trim();
            }
            else if (line.startsWith('http') || line.startsWith('https')) {
                try {
                    const finalUrl = await resolveFinalUrl(line.trim());
                    if (finalUrl) {
                        channels.push({ name: currentName, url: finalUrl });
                    }
                }
                catch (error) {
                    console.error(`Failed to resolve URL for channel ${currentName}:`, error);
                }
            }
        }
        return channels;
    }
    async function resolveFinalUrl(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch ${url}`);
            }
            const data = await response.text();
            if (data.includes('#EXT-X-STREAM-INF')) {
                const lines = data.split('\n');
                for (const line of lines) {
                    if (line && !line.startsWith('#')) {
                        const resolvedUrl = new URL(line.trim(), url).toString();
                        return resolvedUrl;
                    }
                }
            }
            return url;
        }
        catch (error) {
            console.error("Failed to fetch or parse URL:", error);
            return null;
        }
    }
    async function loadPlaylist(url) {
        const loadingIndicator = document.getElementById('loadingIndicator');
        const loadPlaylistButton = document.getElementById('loadPlaylist');
        try {
            loadingIndicator.style.display = 'block';
            loadPlaylistButton.disabled = true;
            const channels = await parseM3U(url);
            const channelList = document.getElementById('channelList');
            channelList.innerHTML = '';
            channels.forEach(channel => {
                const li = document.createElement('li');
                li.textContent = channel.name;
                li.addEventListener('click', () => subscribeToChannel(channel.url));
                channelList.appendChild(li);
            });
        }
        catch (error) {
            console.error("Failed to load playlist:", error);
        }
        finally {
            loadingIndicator.style.display = 'none';
            loadPlaylistButton.disabled = false;
        }
    }
    async function subscribeToChannel(channelUrl) {
        try {
            const session = await src_1.Session.connect(serverUrl);
            const videoTrackNamespace = `iptv-moq/${encodeURIComponent(channelUrl)}`;
            console.log("Subscribing to namespace:", videoTrackNamespace);
            const videoSubscription = await session.subscribe(videoTrackNamespace, 'video');
            const audioSubscription = await session.subscribe(videoTrackNamespace, 'audio');
            const mediaSource = new MediaSource();
            videoPlayer.src = URL.createObjectURL(mediaSource);
            mediaSource.addEventListener('sourceopen', () => {
                const videoSourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
                const audioSourceBuffer = mediaSource.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
                const processVideo = ({ done, value }) => {
                    if (done || !value)
                        return;
                    videoSourceBuffer.appendBuffer(value.objectPayload);
                    videoSubscription.readableStream.getReader().read().then(processVideo);
                };
                const processAudio = ({ done, value }) => {
                    if (done || !value)
                        return;
                    audioSourceBuffer.appendBuffer(value.objectPayload);
                    audioSubscription.readableStream.getReader().read().then(processAudio);
                };
                videoSubscription.readableStream.getReader().read().then(processVideo);
                audioSubscription.readableStream.getReader().read().then(processAudio);
            });
        }
        catch (error) {
            console.error("Failed to set up MoQ session:", error);
        }
    }
    document.getElementById('loadPlaylist').addEventListener('click', () => {
        const playlistUrl = document.getElementById('playlistUrl').value;
        loadPlaylist(playlistUrl);
    });
}
main();

})();

/******/ })()
;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVuZGxlLmpzIiwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7QUFBYTtBQUNiLDhDQUE2QyxFQUFFLGFBQWEsRUFBQztBQUM3RCxxQkFBcUI7QUFDckIsbUJBQW1CLG1CQUFPLENBQUMsb0VBQVk7QUFDdkM7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLGtEQUFrRCx1Q0FBdUM7QUFDekY7QUFDQSxTQUFTO0FBQ1Q7QUFDQTtBQUNBLGdCQUFnQixjQUFjO0FBQzlCO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxlQUFlO0FBQ2Ysb0JBQW9CLGNBQWM7QUFDbEM7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EscUJBQXFCOzs7Ozs7Ozs7OztBQ2pEUjtBQUNiLDhDQUE2QyxFQUFFLGFBQWEsRUFBQztBQUM3RCwyQkFBMkIsR0FBRyw0QkFBNEI7QUFDMUQsbUJBQW1CLG1CQUFPLENBQUMsb0VBQVk7QUFDdkM7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLENBQUMsb0NBQW9DO0FBQ3JDO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLCtDQUErQyxjQUFjO0FBQzdEO0FBQ0E7QUFDQSxvQkFBb0IsY0FBYztBQUNsQztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsZUFBZTtBQUNmLG9CQUFvQixjQUFjO0FBQ2xDO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EscURBQXFELGtCQUFrQjtBQUN2RTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EscURBQXFELGtCQUFrQjtBQUN2RTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EscURBQXFELGtCQUFrQjtBQUN2RTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EscURBQXFELGtCQUFrQjtBQUN2RTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSx3QkFBd0IsU0FBUztBQUNqQztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLG9EQUFvRCxHQUFHO0FBQ3ZEO0FBQ0E7QUFDQSw0QkFBNEI7QUFDNUI7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLGFBQWE7QUFDYjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLGFBQWE7QUFDYjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FB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O0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSx3Q0FBd0Msa0NBQWtDO0FBQzFFO0FBQ0E7QUFDQTtBQUNBLHVFQUF1RSxZQUFZO0FBQ25GO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLG1EQUFtRCxJQUFJO0FBQ3ZEO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxhQUFhO0FBQ2I7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0Esb0RBQW9ELCtCQUErQjtBQUNuRjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxrRkFBa0Y7QUFDbEYsa0ZBQWtGO0FBQ2xGLHdDQUF3QyxhQUFhO0FBQ3JEO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSx3Q0FBd0MsYUFBYTtBQUNyRDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLGFBQWE7QUFDYjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsS0FBSztBQUNMO0FBQ0EiLCJzb3VyY2VzIjpbIndlYnBhY2s6Ly9tb3Etd2ViLWNsaWVudC8uL25vZGVfbW9kdWxlcy9AbWVuZ2VsYmFydC9tb3Fqcy9zcmMvY29udHJvbF9zdHJlYW0udHMiLCJ3ZWJwYWNrOi8vbW9xLXdlYi1jbGllbnQvLi9ub2RlX21vZHVsZXMvQG1lbmdlbGJhcnQvbW9xanMvc3JjL2RlY29kZXIudHMiLCJ3ZWJwYWNrOi8vbW9xLXdlYi1jbGllbnQvLi9ub2RlX21vZHVsZXMvQG1lbmdlbGJhcnQvbW9xanMvc3JjL2VuY29kZXIudHMiLCJ3ZWJwYWNrOi8vbW9xLXdlYi1jbGllbnQvLi9ub2RlX21vZHVsZXMvQG1lbmdlbGJhcnQvbW9xanMvc3JjL2luZGV4LnRzIiwid2VicGFjazovL21vcS13ZWItY2xpZW50Ly4vbm9kZV9tb2R1bGVzL0BtZW5nZWxiYXJ0L21vcWpzL3NyYy9tZXNzYWdlcy50cyIsIndlYnBhY2s6Ly9tb3Etd2ViLWNsaWVudC8uL25vZGVfbW9kdWxlcy9AbWVuZ2VsYmFydC9tb3Fqcy9zcmMvc2Vzc2lvbi50cyIsIndlYnBhY2s6Ly9tb3Etd2ViLWNsaWVudC8uL25vZGVfbW9kdWxlcy9AbWVuZ2VsYmFydC9tb3Fqcy9zcmMvc3Vic2NyaXB0aW9uLnRzIiwid2VicGFjazovL21vcS13ZWItY2xpZW50Ly4vbm9kZV9tb2R1bGVzL0BtZW5nZWxiYXJ0L21vcWpzL3NyYy92YXJpbnQudHMiLCJ3ZWJwYWNrOi8vbW9xLXdlYi1jbGllbnQvd2VicGFjay9ib290c3RyYXAiLCJ3ZWJwYWNrOi8vbW9xLXdlYi1jbGllbnQvLi9zcmMvaW5kZXgudHMiXSwic291cmNlc0NvbnRlbnQiOlsiXCJ1c2Ugc3RyaWN0XCI7XG5PYmplY3QuZGVmaW5lUHJvcGVydHkoZXhwb3J0cywgXCJfX2VzTW9kdWxlXCIsIHsgdmFsdWU6IHRydWUgfSk7XG5leHBvcnRzLkNvbnRyb2xTdHJlYW0gPSB2b2lkIDA7XG5jb25zdCBtZXNzYWdlc18xID0gcmVxdWlyZShcIi4vbWVzc2FnZXNcIik7XG5jbGFzcyBDb250cm9sU3RyZWFtIHtcbiAgICBjb25zdHJ1Y3RvcihyLCB3KSB7XG4gICAgICAgIHRoaXMucmVhZGVyID0gcjtcbiAgICAgICAgdGhpcy53cml0ZXIgPSB3O1xuICAgIH1cbiAgICBhc3luYyBoYW5kc2hha2UoKSB7XG4gICAgICAgIGNvbnN0IHdyaXRlciA9IHRoaXMud3JpdGVyLmdldFdyaXRlcigpO1xuICAgICAgICBhd2FpdCB3cml0ZXIud3JpdGUobmV3IG1lc3NhZ2VzXzEuQ2xpZW50U2V0dXBFbmNvZGVyKHtcbiAgICAgICAgICAgIHR5cGU6IG1lc3NhZ2VzXzEuTWVzc2FnZVR5cGUuQ2xpZW50U2V0dXAsXG4gICAgICAgICAgICB2ZXJzaW9uczogW21lc3NhZ2VzXzEuQ1VSUkVOVF9TVVBQT1JURURfRFJBRlRdLFxuICAgICAgICAgICAgcGFyYW1ldGVyczogW1xuICAgICAgICAgICAgICAgIG5ldyBtZXNzYWdlc18xLlBhcmFtZXRlckVuY29kZXIoeyB0eXBlOiAwLCB2YWx1ZTogbmV3IFVpbnQ4QXJyYXkoWzB4Ml0pIH0pLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgfSkpO1xuICAgICAgICB3cml0ZXIucmVsZWFzZUxvY2soKTtcbiAgICAgICAgY29uc3QgcmVhZGVyID0gdGhpcy5yZWFkZXIuZ2V0UmVhZGVyKCk7XG4gICAgICAgIGNvbnN0IHsgdmFsdWUsIGRvbmUgfSA9IGF3YWl0IHJlYWRlci5yZWFkKCk7XG4gICAgICAgIGlmIChkb25lKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJjb250cm9sIHN0cmVhbSBjbG9zZWRcIik7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHZhbHVlLnR5cGUgIT0gbWVzc2FnZXNfMS5NZXNzYWdlVHlwZS5TZXJ2ZXJTZXR1cCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiaW52YWxpZCBmaXJzdCBtZXNzYWdlIG9uIGNvbnRyb2wgc3RyZWFtXCIpO1xuICAgICAgICB9XG4gICAgICAgIC8vIFRPRE86IEV2YWx1YXRlIHNlcnZlciBzZXR1cCBtZXNzYWdlP1xuICAgICAgICByZWFkZXIucmVsZWFzZUxvY2soKTtcbiAgICB9XG4gICAgYXN5bmMgcnVuUmVhZExvb3AoKSB7XG4gICAgICAgIGNvbnN0IHJlYWRlciA9IHRoaXMucmVhZGVyLmdldFJlYWRlcigpO1xuICAgICAgICBmb3IgKDs7KSB7XG4gICAgICAgICAgICBjb25zdCB7IHZhbHVlLCBkb25lIH0gPSBhd2FpdCByZWFkZXIucmVhZCgpO1xuICAgICAgICAgICAgaWYgKGRvbmUpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhcImNvbnRyb2wgc3RyZWFtIGNsb3NlZFwiKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh0aGlzLm9ubWVzc2FnZSkge1xuICAgICAgICAgICAgICAgIHRoaXMub25tZXNzYWdlKHZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICBhc3luYyBzZW5kKG0pIHtcbiAgICAgICAgY29uc3Qgd3JpdGVyID0gdGhpcy53cml0ZXIuZ2V0V3JpdGVyKCk7XG4gICAgICAgIGF3YWl0IHdyaXRlci53cml0ZShtKTtcbiAgICAgICAgd3JpdGVyLnJlbGVhc2VMb2NrKCk7XG4gICAgfVxufVxuZXhwb3J0cy5Db250cm9sU3RyZWFtID0gQ29udHJvbFN0cmVhbTtcbiIsIlwidXNlIHN0cmljdFwiO1xuT2JqZWN0LmRlZmluZVByb3BlcnR5KGV4cG9ydHMsIFwiX19lc01vZHVsZVwiLCB7IHZhbHVlOiB0cnVlIH0pO1xuZXhwb3J0cy5PYmplY3RTdHJlYW1EZWNvZGVyID0gZXhwb3J0cy5Db250cm9sU3RyZWFtRGVjb2RlciA9IHZvaWQgMDtcbmNvbnN0IG1lc3NhZ2VzXzEgPSByZXF1aXJlKFwiLi9tZXNzYWdlc1wiKTtcbnZhciBFbmNvZGVyU3RhdGU7XG4oZnVuY3Rpb24gKEVuY29kZXJTdGF0ZSkge1xuICAgIEVuY29kZXJTdGF0ZVtFbmNvZGVyU3RhdGVbXCJJbml0XCJdID0gMF0gPSBcIkluaXRcIjtcbiAgICBFbmNvZGVyU3RhdGVbRW5jb2RlclN0YXRlW1wiVHJhY2tTdHJlYW1cIl0gPSAxXSA9IFwiVHJhY2tTdHJlYW1cIjtcbiAgICBFbmNvZGVyU3RhdGVbRW5jb2RlclN0YXRlW1wiR3JvdXBTdHJlYW1cIl0gPSAyXSA9IFwiR3JvdXBTdHJlYW1cIjtcbn0pKEVuY29kZXJTdGF0ZSB8fCAoRW5jb2RlclN0YXRlID0ge30pKTtcbmNsYXNzIERlY29kZXIge1xuICAgIGNvbnN0cnVjdG9yKHN0cmVhbSkge1xuICAgICAgICB0aGlzLnJlYWRlciA9IHN0cmVhbTtcbiAgICAgICAgdGhpcy5idWZmZXIgPSBuZXcgVWludDhBcnJheSg4KTtcbiAgICB9XG4gICAgYXN5bmMgcmVhZChidWZmZXIsIG9mZnNldCwgbGVuZ3RoKSB7XG4gICAgICAgIGNvbnN0IHJlYWRlciA9IHRoaXMucmVhZGVyLmdldFJlYWRlcih7IG1vZGU6IFwiYnlvYlwiIH0pO1xuICAgICAgICB3aGlsZSAob2Zmc2V0IDwgbGVuZ3RoKSB7XG4gICAgICAgICAgICBjb25zdCBidWYgPSBuZXcgVWludDhBcnJheShidWZmZXIuYnVmZmVyLCBidWZmZXIuYnl0ZU9mZnNldCArIG9mZnNldCwgbGVuZ3RoIC0gb2Zmc2V0KTtcbiAgICAgICAgICAgIGNvbnN0IHsgdmFsdWUsIGRvbmUgfSA9IGF3YWl0IHJlYWRlci5yZWFkKGJ1Zik7XG4gICAgICAgICAgICBpZiAoZG9uZSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcInN0cmVhbSBjbG9zZWRcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBidWZmZXIgPSBuZXcgVWludDhBcnJheSh2YWx1ZS5idWZmZXIsIHZhbHVlLmJ5dGVPZmZzZXQgLSBvZmZzZXQpO1xuICAgICAgICAgICAgb2Zmc2V0ICs9IHZhbHVlLmJ5dGVMZW5ndGg7XG4gICAgICAgIH1cbiAgICAgICAgcmVhZGVyLnJlbGVhc2VMb2NrKCk7XG4gICAgICAgIHJldHVybiBidWZmZXI7XG4gICAgfVxuICAgIGFzeW5jIHJlYWROKG4pIHtcbiAgICAgICAgY29uc3QgYnVmZmVyID0gbmV3IFVpbnQ4QXJyYXkobik7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCB0aGlzLnJlYWQoYnVmZmVyLCAwLCBuKTtcbiAgICAgICAgcmV0dXJuIGRhdGE7XG4gICAgfVxuICAgIGFzeW5jIHJlYWRBbGwoKSB7XG4gICAgICAgIGNvbnN0IHJlYWRlciA9IHRoaXMucmVhZGVyLmdldFJlYWRlcigpO1xuICAgICAgICBsZXQgYnVmZmVyID0gbmV3IFVpbnQ4QXJyYXkoKTtcbiAgICAgICAgZm9yICg7Oykge1xuICAgICAgICAgICAgY29uc3QgeyB2YWx1ZSwgZG9uZSB9ID0gYXdhaXQgcmVhZGVyLnJlYWQoKTtcbiAgICAgICAgICAgIGlmIChkb25lKSB7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zdCBuZXh0ID0gbmV3IFVpbnQ4QXJyYXkoYnVmZmVyLmJ5dGVMZW5ndGggKyB2YWx1ZS5ieXRlTGVuZ3RoKTtcbiAgICAgICAgICAgIG5leHQuc2V0KGJ1ZmZlcik7XG4gICAgICAgICAgICBuZXh0LnNldCh2YWx1ZSwgYnVmZmVyLmJ5dGVMZW5ndGgpO1xuICAgICAgICAgICAgYnVmZmVyID0gbmV4dDtcbiAgICAgICAgfVxuICAgICAgICByZWFkZXIucmVsZWFzZUxvY2soKTtcbiAgICAgICAgcmV0dXJuIGJ1ZmZlcjtcbiAgICB9XG4gICAgYXN5bmMgcmVhZFZhcmludCgpIHtcbiAgICAgICAgdGhpcy5idWZmZXIgPSBhd2FpdCB0aGlzLnJlYWQodGhpcy5idWZmZXIsIDAsIDEpO1xuICAgICAgICBpZiAodGhpcy5idWZmZXIubGVuZ3RoICE9PSAxKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJyZWFkVmFyaW50IGNvdWxkIG5vdCByZWFkIGZpcnN0IGJ5dGVcIik7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcHJlZml4ID0gdGhpcy5idWZmZXJbMF0gPj4gNjtcbiAgICAgICAgY29uc3QgbGVuZ3RoID0gMSA8PCBwcmVmaXg7XG4gICAgICAgIGxldCB2aWV3ID0gbmV3IERhdGFWaWV3KHRoaXMuYnVmZmVyLmJ1ZmZlciwgMCwgbGVuZ3RoKTtcbiAgICAgICAgc3dpdGNoIChsZW5ndGgpIHtcbiAgICAgICAgICAgIGNhc2UgMTpcbiAgICAgICAgICAgICAgICByZXR1cm4gdmlldy5nZXRVaW50OCgwKSAmIDB4M2Y7XG4gICAgICAgICAgICBjYXNlIDI6XG4gICAgICAgICAgICAgICAgdGhpcy5idWZmZXIgPSBhd2FpdCB0aGlzLnJlYWQodGhpcy5idWZmZXIsIDEsIDIpO1xuICAgICAgICAgICAgICAgIHZpZXcgPSBuZXcgRGF0YVZpZXcodGhpcy5idWZmZXIuYnVmZmVyLCAwLCBsZW5ndGgpO1xuICAgICAgICAgICAgICAgIHJldHVybiB2aWV3LmdldFVpbnQxNigwKSAmIDB4M2ZmZjtcbiAgICAgICAgICAgIGNhc2UgNDpcbiAgICAgICAgICAgICAgICB0aGlzLmJ1ZmZlciA9IGF3YWl0IHRoaXMucmVhZCh0aGlzLmJ1ZmZlciwgMSwgNCk7XG4gICAgICAgICAgICAgICAgdmlldyA9IG5ldyBEYXRhVmlldyh0aGlzLmJ1ZmZlci5idWZmZXIsIDAsIGxlbmd0aCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHZpZXcuZ2V0VWludDMyKDApICYgMHgzZmZmZmZmZjtcbiAgICAgICAgICAgIGNhc2UgODpcbiAgICAgICAgICAgICAgICB0aGlzLmJ1ZmZlciA9IGF3YWl0IHRoaXMucmVhZCh0aGlzLmJ1ZmZlciwgMSwgOCk7XG4gICAgICAgICAgICAgICAgdmlldyA9IG5ldyBEYXRhVmlldyh0aGlzLmJ1ZmZlci5idWZmZXIsIDAsIGxlbmd0aCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHZpZXcuZ2V0QmlnVWludDY0KDApICYgMHgzZmZmZmZmZmZmZmZmZmZmbjtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJpbnZhbGlkIHZhcmludCBsZW5ndGhcIik7XG4gICAgfVxuICAgIGFzeW5jIG9iamVjdFN0cmVhbSgpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHR5cGU6IG1lc3NhZ2VzXzEuTWVzc2FnZVR5cGUuT2JqZWN0U3RyZWFtLFxuICAgICAgICAgICAgc3Vic2NyaWJlSWQ6IGF3YWl0IHRoaXMucmVhZFZhcmludCgpLFxuICAgICAgICAgICAgdHJhY2tBbGlhczogYXdhaXQgdGhpcy5yZWFkVmFyaW50KCksXG4gICAgICAgICAgICBncm91cElkOiBhd2FpdCB0aGlzLnJlYWRWYXJpbnQoKSxcbiAgICAgICAgICAgIG9iamVjdElkOiBhd2FpdCB0aGlzLnJlYWRWYXJpbnQoKSxcbiAgICAgICAgICAgIHB1Ymxpc2hlclByaW9yaXR5OiAoYXdhaXQgdGhpcy5yZWFkTigxKSlbMF0sXG4gICAgICAgICAgICBvYmplY3RTdGF0dXM6IGF3YWl0IHRoaXMucmVhZFZhcmludCgpLFxuICAgICAgICAgICAgb2JqZWN0UGF5bG9hZDogYXdhaXQgdGhpcy5yZWFkQWxsKCksXG4gICAgICAgIH07XG4gICAgfVxuICAgIGFzeW5jIHN1YnNjcmliZSgpIHtcbiAgICAgICAgY29uc3Qgc3Vic2NyaWJlSWQgPSBhd2FpdCB0aGlzLnJlYWRWYXJpbnQoKTtcbiAgICAgICAgY29uc3QgdHJhY2tBbGlhcyA9IGF3YWl0IHRoaXMucmVhZFZhcmludCgpO1xuICAgICAgICBjb25zdCB0cmFja05hbWVzcGFjZSA9IGF3YWl0IHRoaXMuc3RyaW5nKCk7XG4gICAgICAgIGNvbnN0IHRyYWNrTmFtZSA9IGF3YWl0IHRoaXMuc3RyaW5nKCk7XG4gICAgICAgIGNvbnN0IHN1YnNjcmliZXJQcmlvcml0eSA9IChhd2FpdCB0aGlzLnJlYWROKDEpKVswXTtcbiAgICAgICAgY29uc3QgZ3JvdXBPcmRlciA9IChhd2FpdCB0aGlzLnJlYWROKDEpKVswXTtcbiAgICAgICAgY29uc3QgZmlsdGVyVHlwZSA9IGF3YWl0IHRoaXMucmVhZFZhcmludCgpO1xuICAgICAgICBsZXQgc3RhcnRHcm91cDtcbiAgICAgICAgbGV0IHN0YXJ0T2JqZWN0O1xuICAgICAgICBsZXQgZW5kR3JvdXA7XG4gICAgICAgIGxldCBlbmRPYmplY3Q7XG4gICAgICAgIGlmIChmaWx0ZXJUeXBlID09PSBtZXNzYWdlc18xLkZpbHRlclR5cGUuQWJzb2x1dGVTdGFydCB8fFxuICAgICAgICAgICAgZmlsdGVyVHlwZSA9PSBtZXNzYWdlc18xLkZpbHRlclR5cGUuQWJzb2x1dGVSYW5nZSkge1xuICAgICAgICAgICAgc3RhcnRHcm91cCA9IGF3YWl0IHRoaXMucmVhZFZhcmludCgpO1xuICAgICAgICAgICAgc3RhcnRPYmplY3QgPSBhd2FpdCB0aGlzLnJlYWRWYXJpbnQoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZmlsdGVyVHlwZSA9PSBtZXNzYWdlc18xLkZpbHRlclR5cGUuQWJzb2x1dGVSYW5nZSkge1xuICAgICAgICAgICAgZW5kR3JvdXAgPSBhd2FpdCB0aGlzLnJlYWRWYXJpbnQoKTtcbiAgICAgICAgICAgIGVuZE9iamVjdCA9IGF3YWl0IHRoaXMucmVhZFZhcmludCgpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0eXBlOiBtZXNzYWdlc18xLk1lc3NhZ2VUeXBlLlN1YnNjcmliZSxcbiAgICAgICAgICAgIHN1YnNjcmliZUlkLFxuICAgICAgICAgICAgdHJhY2tBbGlhcyxcbiAgICAgICAgICAgIHRyYWNrTmFtZXNwYWNlLFxuICAgICAgICAgICAgdHJhY2tOYW1lLFxuICAgICAgICAgICAgc3Vic2NyaWJlclByaW9yaXR5LFxuICAgICAgICAgICAgZ3JvdXBPcmRlcixcbiAgICAgICAgICAgIGZpbHRlclR5cGUsXG4gICAgICAgICAgICBzdGFydEdyb3VwLFxuICAgICAgICAgICAgc3RhcnRPYmplY3QsXG4gICAgICAgICAgICBlbmRHcm91cCxcbiAgICAgICAgICAgIGVuZE9iamVjdCxcbiAgICAgICAgICAgIHN1YnNjcmliZVBhcmFtZXRlcnM6IGF3YWl0IHRoaXMucGFyYW1ldGVycygpLFxuICAgICAgICB9O1xuICAgIH1cbiAgICBhc3luYyBzdWJzY3JpYmVVcGRhdGUoKSB7XG4gICAgICAgIGNvbnN0IHN1YnNjcmliZUlkID0gYXdhaXQgdGhpcy5yZWFkVmFyaW50KCk7XG4gICAgICAgIGNvbnN0IHN0YXJ0R3JvdXAgPSBhd2FpdCB0aGlzLnJlYWRWYXJpbnQoKTtcbiAgICAgICAgY29uc3Qgc3RhcnRPYmplY3QgPSBhd2FpdCB0aGlzLnJlYWRWYXJpbnQoKTtcbiAgICAgICAgY29uc3QgZW5kR3JvdXAgPSBhd2FpdCB0aGlzLnJlYWRWYXJpbnQoKTtcbiAgICAgICAgY29uc3QgZW5kT2JqZWN0ID0gYXdhaXQgdGhpcy5yZWFkVmFyaW50KCk7XG4gICAgICAgIGNvbnN0IHN1YnNjcmliZXJQcmlvcml0eSA9IChhd2FpdCB0aGlzLnJlYWROKDEpKVswXTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHR5cGU6IG1lc3NhZ2VzXzEuTWVzc2FnZVR5cGUuU3Vic2NyaWJlVXBkYXRlLFxuICAgICAgICAgICAgc3Vic2NyaWJlSWQsXG4gICAgICAgICAgICBzdGFydEdyb3VwLFxuICAgICAgICAgICAgc3RhcnRPYmplY3QsXG4gICAgICAgICAgICBlbmRHcm91cCxcbiAgICAgICAgICAgIGVuZE9iamVjdCxcbiAgICAgICAgICAgIHN1YnNjcmliZXJQcmlvcml0eSxcbiAgICAgICAgICAgIHN1YnNjcmliZVBhcmFtZXRlcnM6IGF3YWl0IHRoaXMucGFyYW1ldGVycygpLFxuICAgICAgICB9O1xuICAgIH1cbiAgICBhc3luYyBzdWJzY3JpYmVPaygpIHtcbiAgICAgICAgY29uc3Qgc3Vic2NyaWJlSWQgPSBhd2FpdCB0aGlzLnJlYWRWYXJpbnQoKTtcbiAgICAgICAgY29uc3QgZXhwaXJlcyA9IGF3YWl0IHRoaXMucmVhZFZhcmludCgpO1xuICAgICAgICBjb25zdCBncm91cE9yZGVyID0gKGF3YWl0IHRoaXMucmVhZE4oMSkpWzBdO1xuICAgICAgICBjb25zdCBjb250ZW50RXhpc3RzID0gKGF3YWl0IHRoaXMucmVhZFZhcmludCgpKSA9PSAxO1xuICAgICAgICBsZXQgZmluYWxHcm91cDtcbiAgICAgICAgbGV0IGZpbmFsT2JqZWN0O1xuICAgICAgICBpZiAoY29udGVudEV4aXN0cykge1xuICAgICAgICAgICAgZmluYWxHcm91cCA9IGF3YWl0IHRoaXMucmVhZFZhcmludCgpO1xuICAgICAgICAgICAgZmluYWxPYmplY3QgPSBhd2FpdCB0aGlzLnJlYWRWYXJpbnQoKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdHlwZTogbWVzc2FnZXNfMS5NZXNzYWdlVHlwZS5TdWJzY3JpYmVPayxcbiAgICAgICAgICAgIHN1YnNjcmliZUlkLFxuICAgICAgICAgICAgZXhwaXJlcyxcbiAgICAgICAgICAgIGdyb3VwT3JkZXIsXG4gICAgICAgICAgICBjb250ZW50RXhpc3RzLFxuICAgICAgICAgICAgZmluYWxHcm91cCxcbiAgICAgICAgICAgIGZpbmFsT2JqZWN0LFxuICAgICAgICB9O1xuICAgIH1cbiAgICBhc3luYyBzdWJzY3JpYmVFcnJvcigpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHR5cGU6IG1lc3NhZ2VzXzEuTWVzc2FnZVR5cGUuU3Vic2NyaWJlRXJyb3IsXG4gICAgICAgICAgICBzdWJzY3JpYmVJZDogYXdhaXQgdGhpcy5yZWFkVmFyaW50KCksXG4gICAgICAgICAgICBlcnJvckNvZGU6IGF3YWl0IHRoaXMucmVhZFZhcmludCgpLFxuICAgICAgICAgICAgcmVhc29uUGhyYXNlOiBhd2FpdCB0aGlzLnN0cmluZygpLFxuICAgICAgICAgICAgdHJhY2tBbGlhczogYXdhaXQgdGhpcy5yZWFkVmFyaW50KCksXG4gICAgICAgIH07XG4gICAgfVxuICAgIGFzeW5jIGFubm91bmNlKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdHlwZTogbWVzc2FnZXNfMS5NZXNzYWdlVHlwZS5Bbm5vdW5jZSxcbiAgICAgICAgICAgIG5hbWVzcGFjZTogYXdhaXQgdGhpcy5zdHJpbmcoKSxcbiAgICAgICAgICAgIHBhcmFtZXRlcnM6IGF3YWl0IHRoaXMucGFyYW1ldGVycygpLFxuICAgICAgICB9O1xuICAgIH1cbiAgICBhc3luYyBhbm5vdW5jZU9rKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdHlwZTogbWVzc2FnZXNfMS5NZXNzYWdlVHlwZS5Bbm5vdW5jZU9rLFxuICAgICAgICAgICAgdHJhY2tOYW1lc3BhY2U6IGF3YWl0IHRoaXMuc3RyaW5nKCksXG4gICAgICAgIH07XG4gICAgfVxuICAgIGFzeW5jIGFubm91bmNlRXJyb3IoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0eXBlOiBtZXNzYWdlc18xLk1lc3NhZ2VUeXBlLkFubm91bmNlRXJyb3IsXG4gICAgICAgICAgICB0cmFja05hbWVzcGFjZTogYXdhaXQgdGhpcy5zdHJpbmcoKSxcbiAgICAgICAgICAgIGVycm9yQ29kZTogYXdhaXQgdGhpcy5yZWFkVmFyaW50KCksXG4gICAgICAgICAgICByZWFzb25QaHJhc2U6IGF3YWl0IHRoaXMuc3RyaW5nKCksXG4gICAgICAgIH07XG4gICAgfVxuICAgIGFzeW5jIHVuYW5ub3VuY2UoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0eXBlOiBtZXNzYWdlc18xLk1lc3NhZ2VUeXBlLlVuYW5ub3VuY2UsXG4gICAgICAgICAgICB0cmFja05hbWVzcGFjZTogYXdhaXQgdGhpcy5zdHJpbmcoKSxcbiAgICAgICAgfTtcbiAgICB9XG4gICAgYXN5bmMgdW5zdWJzY3JpYmUoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0eXBlOiBtZXNzYWdlc18xLk1lc3NhZ2VUeXBlLlVuc3Vic2NyaWJlLFxuICAgICAgICAgICAgc3Vic2NyaWJlSWQ6IGF3YWl0IHRoaXMucmVhZFZhcmludCgpLFxuICAgICAgICB9O1xuICAgIH1cbiAgICBhc3luYyBzdWJzY3JpYmVEb25lKCkge1xuICAgICAgICBjb25zdCBzdWJzY3JpYmVJZCA9IGF3YWl0IHRoaXMucmVhZFZhcmludCgpO1xuICAgICAgICBjb25zdCBzdGF0dXNDb2RlID0gYXdhaXQgdGhpcy5yZWFkVmFyaW50KCk7XG4gICAgICAgIGNvbnN0IHJlYXNvblBocmFzZSA9IGF3YWl0IHRoaXMuc3RyaW5nKCk7XG4gICAgICAgIGNvbnN0IGNvbnRlbnRFeGlzdHMgPSAoYXdhaXQgdGhpcy5yZWFkVmFyaW50KCkpID09IDE7XG4gICAgICAgIGxldCBmaW5hbEdyb3VwO1xuICAgICAgICBsZXQgZmluYWxPYmplY3Q7XG4gICAgICAgIGlmIChjb250ZW50RXhpc3RzKSB7XG4gICAgICAgICAgICBmaW5hbEdyb3VwID0gYXdhaXQgdGhpcy5yZWFkVmFyaW50KCk7XG4gICAgICAgICAgICBmaW5hbE9iamVjdCA9IGF3YWl0IHRoaXMucmVhZFZhcmludCgpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0eXBlOiBtZXNzYWdlc18xLk1lc3NhZ2VUeXBlLlN1YnNjcmliZURvbmUsXG4gICAgICAgICAgICBzdWJzY3JpYmVJZCxcbiAgICAgICAgICAgIHN0YXR1c0NvZGUsXG4gICAgICAgICAgICByZWFzb25QaHJhc2UsXG4gICAgICAgICAgICBjb250ZW50RXhpc3RzLFxuICAgICAgICAgICAgZmluYWxHcm91cCxcbiAgICAgICAgICAgIGZpbmFsT2JqZWN0LFxuICAgICAgICB9O1xuICAgIH1cbiAgICBhc3luYyBnb0F3YXkoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0eXBlOiBtZXNzYWdlc18xLk1lc3NhZ2VUeXBlLkdvQXdheSxcbiAgICAgICAgICAgIG5ld1Nlc3Npb25VUkk6IGF3YWl0IHRoaXMuc3RyaW5nKCksXG4gICAgICAgIH07XG4gICAgfVxuICAgIGFzeW5jIHNlcnZlclNldHVwKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdHlwZTogbWVzc2FnZXNfMS5NZXNzYWdlVHlwZS5TZXJ2ZXJTZXR1cCxcbiAgICAgICAgICAgIHNlbGVjdGVkVmVyc2lvbjogYXdhaXQgdGhpcy5yZWFkVmFyaW50KCksXG4gICAgICAgICAgICBwYXJhbWV0ZXJzOiBhd2FpdCB0aGlzLnBhcmFtZXRlcnMoKSxcbiAgICAgICAgfTtcbiAgICB9XG4gICAgYXN5bmMgc3RyZWFtSGVhZGVyVHJhY2soKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0eXBlOiBtZXNzYWdlc18xLk1lc3NhZ2VUeXBlLlN0cmVhbUhlYWRlclRyYWNrLFxuICAgICAgICAgICAgc3Vic2NyaWJlSWQ6IGF3YWl0IHRoaXMucmVhZFZhcmludCgpLFxuICAgICAgICAgICAgdHJhY2tBbGlhczogYXdhaXQgdGhpcy5yZWFkVmFyaW50KCksXG4gICAgICAgICAgICBwdWJsaXNoZXJQcmlvcml0eTogKGF3YWl0IHRoaXMucmVhZE4oMSkpWzBdLFxuICAgICAgICB9O1xuICAgIH1cbiAgICBhc3luYyBzdHJlYW1IZWFkZXJUcmFja09iamVjdCgpIHtcbiAgICAgICAgY29uc3QgZ3JvdXBJZCA9IGF3YWl0IHRoaXMucmVhZFZhcmludCgpO1xuICAgICAgICBjb25zdCBvYmplY3RJZCA9IGF3YWl0IHRoaXMucmVhZFZhcmludCgpO1xuICAgICAgICBjb25zdCBsZW5ndGggPSBhd2FpdCB0aGlzLnJlYWRWYXJpbnQoKTtcbiAgICAgICAgaWYgKGxlbmd0aCA+IE51bWJlci5NQVhfVkFMVUUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgY2Fubm90IHJlYWQgbW9yZSB0aGVuICR7TnVtYmVyLk1BWF9WQUxVRX0gYnl0ZXMgZnJvbSBzdHJlYW1gKTtcbiAgICAgICAgfVxuICAgICAgICBsZXQgb2JqZWN0U3RhdHVzO1xuICAgICAgICBpZiAobGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBvYmplY3RTdGF0dXMgPSBhd2FpdCB0aGlzLnJlYWRWYXJpbnQoKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgZ3JvdXBJZCxcbiAgICAgICAgICAgIG9iamVjdElkLFxuICAgICAgICAgICAgb2JqZWN0U3RhdHVzLFxuICAgICAgICAgICAgb2JqZWN0UGF5bG9hZDogYXdhaXQgdGhpcy5yZWFkTihsZW5ndGgpLFxuICAgICAgICB9O1xuICAgIH1cbiAgICBhc3luYyBzdHJlYW1IZWFkZXJHcm91cCgpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHR5cGU6IG1lc3NhZ2VzXzEuTWVzc2FnZVR5cGUuU3RyZWFtSGVhZGVyR3JvdXAsXG4gICAgICAgICAgICBzdWJzY3JpYmVJZDogYXdhaXQgdGhpcy5yZWFkVmFyaW50KCksXG4gICAgICAgICAgICB0cmFja0FsaWFzOiBhd2FpdCB0aGlzLnJlYWRWYXJpbnQoKSxcbiAgICAgICAgICAgIGdyb3VwSWQ6IGF3YWl0IHRoaXMucmVhZFZhcmludCgpLFxuICAgICAgICAgICAgcHVibGlzaGVyUHJpb3JpdHk6IChhd2FpdCB0aGlzLnJlYWROKDEpKVswXSxcbiAgICAgICAgfTtcbiAgICB9XG4gICAgYXN5bmMgc3RyZWFtSGVhZGVyR3JvdXBPYmplY3QoKSB7XG4gICAgICAgIGxldCBvYmplY3RJZDtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIC8vIHN0cmVhbSBjYW4gYmUgY2xvc2VkIGlmIHRoZSBwZWVyIGlzIGRvbmUgc2VuZGluZyBhbGwgb2JqZWN0c1xuICAgICAgICAgICAgb2JqZWN0SWQgPSBhd2FpdCB0aGlzLnJlYWRWYXJpbnQoKTtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBsZW5ndGggPSBhd2FpdCB0aGlzLnJlYWRWYXJpbnQoKTtcbiAgICAgICAgaWYgKGxlbmd0aCA+IE51bWJlci5NQVhfVkFMVUUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgY2Fubm90IHJlYWQgbW9yZSB0aGVuICR7TnVtYmVyLk1BWF9WQUxVRX0gYnl0ZXMgZnJvbSBzdHJlYW1gKTtcbiAgICAgICAgfVxuICAgICAgICBsZXQgb2JqZWN0U3RhdHVzO1xuICAgICAgICBpZiAobGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBvYmplY3RTdGF0dXMgPSBhd2FpdCB0aGlzLnJlYWRWYXJpbnQoKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgb2JqZWN0SWQ6IG9iamVjdElkLFxuICAgICAgICAgICAgb2JqZWN0U3RhdHVzLFxuICAgICAgICAgICAgb2JqZWN0UGF5bG9hZDogYXdhaXQgdGhpcy5yZWFkTihsZW5ndGgpLFxuICAgICAgICB9O1xuICAgIH1cbiAgICBhc3luYyBzdHJpbmcoKSB7XG4gICAgICAgIGNvbnN0IGxlbmd0aCA9IGF3YWl0IHRoaXMucmVhZFZhcmludCgpO1xuICAgICAgICBpZiAobGVuZ3RoID4gTnVtYmVyLk1BWF9WQUxVRSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBjYW5ub3QgcmVhZCBtb3JlIHRoZW4gJHtOdW1iZXIuTUFYX1ZBTFVFfSBieXRlcyBmcm9tIHN0cmVhbWApO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCB0aGlzLnJlYWROKGxlbmd0aCk7XG4gICAgICAgIHJldHVybiBuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoZGF0YSk7XG4gICAgfVxuICAgIGFzeW5jIHBhcmFtZXRlcigpIHtcbiAgICAgICAgY29uc3QgdHlwZSA9IGF3YWl0IHRoaXMucmVhZFZhcmludCgpO1xuICAgICAgICBjb25zdCBsZW5ndGggPSBhd2FpdCB0aGlzLnJlYWRWYXJpbnQoKTtcbiAgICAgICAgaWYgKGxlbmd0aCA+IE51bWJlci5NQVhfVkFMVUUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgY2Fubm90IHJlYWQgbW9yZSB0aGVuICR7TnVtYmVyLk1BWF9WQUxVRX0gYnl0ZXMgZnJvbSBzdHJlYW1gKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdHlwZTogdHlwZSxcbiAgICAgICAgICAgIHZhbHVlOiBhd2FpdCB0aGlzLnJlYWROKGxlbmd0aCksXG4gICAgICAgIH07XG4gICAgfVxuICAgIGFzeW5jIHBhcmFtZXRlcnMoKSB7XG4gICAgICAgIGNvbnN0IG51bSA9IGF3YWl0IHRoaXMucmVhZFZhcmludCgpO1xuICAgICAgICBjb25zdCBwYXJhbWV0ZXJzID0gW107XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbnVtOyBpKyspIHtcbiAgICAgICAgICAgIHBhcmFtZXRlcnMucHVzaChhd2FpdCB0aGlzLnBhcmFtZXRlcigpKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcGFyYW1ldGVycztcbiAgICB9XG59XG5jbGFzcyBDb250cm9sU3RyZWFtRGVjb2RlciBleHRlbmRzIERlY29kZXIge1xuICAgIGFzeW5jIHB1bGwoY29udHJvbGxlcikge1xuICAgICAgICBjb25zdCBtdCA9IGF3YWl0IHRoaXMucmVhZFZhcmludCgpO1xuICAgICAgICBzd2l0Y2ggKG10KSB7XG4gICAgICAgICAgICBjYXNlIG1lc3NhZ2VzXzEuTWVzc2FnZVR5cGUuU3Vic2NyaWJlOlxuICAgICAgICAgICAgICAgIHJldHVybiBjb250cm9sbGVyLmVucXVldWUoYXdhaXQgdGhpcy5zdWJzY3JpYmUoKSk7XG4gICAgICAgICAgICBjYXNlIG1lc3NhZ2VzXzEuTWVzc2FnZVR5cGUuU3Vic2NyaWJlVXBkYXRlOlxuICAgICAgICAgICAgICAgIHJldHVybiBjb250cm9sbGVyLmVucXVldWUoYXdhaXQgdGhpcy5zdWJzY3JpYmVVcGRhdGUoKSk7XG4gICAgICAgICAgICBjYXNlIG1lc3NhZ2VzXzEuTWVzc2FnZVR5cGUuU3Vic2NyaWJlT2s6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNvbnRyb2xsZXIuZW5xdWV1ZShhd2FpdCB0aGlzLnN1YnNjcmliZU9rKCkpO1xuICAgICAgICAgICAgY2FzZSBtZXNzYWdlc18xLk1lc3NhZ2VUeXBlLlN1YnNjcmliZUVycm9yOlxuICAgICAgICAgICAgICAgIHJldHVybiBjb250cm9sbGVyLmVucXVldWUoYXdhaXQgdGhpcy5zdWJzY3JpYmVFcnJvcigpKTtcbiAgICAgICAgICAgIGNhc2UgbWVzc2FnZXNfMS5NZXNzYWdlVHlwZS5Bbm5vdW5jZTpcbiAgICAgICAgICAgICAgICByZXR1cm4gY29udHJvbGxlci5lbnF1ZXVlKGF3YWl0IHRoaXMuYW5ub3VuY2UoKSk7XG4gICAgICAgICAgICBjYXNlIG1lc3NhZ2VzXzEuTWVzc2FnZVR5cGUuQW5ub3VuY2VPazpcbiAgICAgICAgICAgICAgICByZXR1cm4gY29udHJvbGxlci5lbnF1ZXVlKGF3YWl0IHRoaXMuYW5ub3VuY2VPaygpKTtcbiAgICAgICAgICAgIGNhc2UgbWVzc2FnZXNfMS5NZXNzYWdlVHlwZS5Bbm5vdW5jZUVycm9yOlxuICAgICAgICAgICAgICAgIHJldHVybiBjb250cm9sbGVyLmVucXVldWUoYXdhaXQgdGhpcy5hbm5vdW5jZUVycm9yKCkpO1xuICAgICAgICAgICAgY2FzZSBtZXNzYWdlc18xLk1lc3NhZ2VUeXBlLlVuYW5ub3VuY2U6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNvbnRyb2xsZXIuZW5xdWV1ZShhd2FpdCB0aGlzLnVuYW5ub3VuY2UoKSk7XG4gICAgICAgICAgICBjYXNlIG1lc3NhZ2VzXzEuTWVzc2FnZVR5cGUuVW5zdWJzY3JpYmU6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNvbnRyb2xsZXIuZW5xdWV1ZShhd2FpdCB0aGlzLnVuc3Vic2NyaWJlKCkpO1xuICAgICAgICAgICAgY2FzZSBtZXNzYWdlc18xLk1lc3NhZ2VUeXBlLlN1YnNjcmliZURvbmU6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNvbnRyb2xsZXIuZW5xdWV1ZShhd2FpdCB0aGlzLnN1YnNjcmliZURvbmUoKSk7XG4gICAgICAgICAgICBjYXNlIG1lc3NhZ2VzXzEuTWVzc2FnZVR5cGUuR29Bd2F5OlxuICAgICAgICAgICAgICAgIHJldHVybiBjb250cm9sbGVyLmVucXVldWUoYXdhaXQgdGhpcy5nb0F3YXkoKSk7XG4gICAgICAgICAgICBjYXNlIG1lc3NhZ2VzXzEuTWVzc2FnZVR5cGUuU2VydmVyU2V0dXA6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNvbnRyb2xsZXIuZW5xdWV1ZShhd2FpdCB0aGlzLnNlcnZlclNldHVwKCkpO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgdW5leHBlY3RlZCBtZXNzYWdlIHR5cGU6ICR7bXR9YCk7XG4gICAgfVxufVxuZXhwb3J0cy5Db250cm9sU3RyZWFtRGVjb2RlciA9IENvbnRyb2xTdHJlYW1EZWNvZGVyO1xuY2xhc3MgT2JqZWN0U3RyZWFtRGVjb2RlciBleHRlbmRzIERlY29kZXIge1xuICAgIGNvbnN0cnVjdG9yKHN0cmVhbSkge1xuICAgICAgICBzdXBlcihzdHJlYW0pO1xuICAgICAgICB0aGlzLnN0YXRlID0gRW5jb2RlclN0YXRlLkluaXQ7XG4gICAgfVxuICAgIGFzeW5jIHB1bGwoY29udHJvbGxlcikge1xuICAgICAgICBpZiAodGhpcy5zdGF0ZSA9PT0gRW5jb2RlclN0YXRlLlRyYWNrU3RyZWFtKSB7XG4gICAgICAgICAgICBjb25zdCBvID0gYXdhaXQgdGhpcy5zdHJlYW1IZWFkZXJUcmFja09iamVjdCgpO1xuICAgICAgICAgICAgcmV0dXJuIGNvbnRyb2xsZXIuZW5xdWV1ZSh7XG4gICAgICAgICAgICAgICAgdHlwZTogbWVzc2FnZXNfMS5NZXNzYWdlVHlwZS5TdHJlYW1IZWFkZXJUcmFjayxcbiAgICAgICAgICAgICAgICBzdWJzY3JpYmVJZDogdGhpcy5zdWJzY3JpYmVJZCxcbiAgICAgICAgICAgICAgICB0cmFja0FsaWFzOiB0aGlzLnRyYWNrQWxpYXMsXG4gICAgICAgICAgICAgICAgZ3JvdXBJZDogby5ncm91cElkLFxuICAgICAgICAgICAgICAgIG9iamVjdElkOiBvLm9iamVjdElkLFxuICAgICAgICAgICAgICAgIHB1Ymxpc2hlclByaW9yaXR5OiB0aGlzLnB1Ymxpc2hlclByaW9yaXR5LFxuICAgICAgICAgICAgICAgIG9iamVjdFN0YXR1czogMCxcbiAgICAgICAgICAgICAgICBvYmplY3RQYXlsb2FkOiBvLm9iamVjdFBheWxvYWQsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5zdGF0ZSA9PT0gRW5jb2RlclN0YXRlLkdyb3VwU3RyZWFtKSB7XG4gICAgICAgICAgICBjb25zdCBvID0gYXdhaXQgdGhpcy5zdHJlYW1IZWFkZXJHcm91cE9iamVjdCgpO1xuICAgICAgICAgICAgaWYgKCFvKSB7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlci5jbG9zZSgpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBjb250cm9sbGVyLmVucXVldWUoe1xuICAgICAgICAgICAgICAgIHR5cGU6IG1lc3NhZ2VzXzEuTWVzc2FnZVR5cGUuU3RyZWFtSGVhZGVyR3JvdXAsXG4gICAgICAgICAgICAgICAgc3Vic2NyaWJlSWQ6IHRoaXMuc3Vic2NyaWJlSWQsXG4gICAgICAgICAgICAgICAgdHJhY2tBbGlhczogdGhpcy50cmFja0FsaWFzLFxuICAgICAgICAgICAgICAgIGdyb3VwSWQ6IHRoaXMuZ3JvdXBJZCxcbiAgICAgICAgICAgICAgICBvYmplY3RJZDogby5vYmplY3RJZCxcbiAgICAgICAgICAgICAgICBwdWJsaXNoZXJQcmlvcml0eTogdGhpcy5wdWJsaXNoZXJQcmlvcml0eSxcbiAgICAgICAgICAgICAgICBvYmplY3RTdGF0dXM6IDAsXG4gICAgICAgICAgICAgICAgb2JqZWN0UGF5bG9hZDogby5vYmplY3RQYXlsb2FkLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgbXQgPSBhd2FpdCB0aGlzLnJlYWRWYXJpbnQoKTtcbiAgICAgICAgY29uc29sZS5sb2coXCJkZWNvZGluZyBtZXNzYWdlIHR5cGVcIiwgbXQpO1xuICAgICAgICBpZiAobXQgPT09IG1lc3NhZ2VzXzEuTWVzc2FnZVR5cGUuT2JqZWN0U3RyZWFtKSB7XG4gICAgICAgICAgICBjb250cm9sbGVyLmVucXVldWUoYXdhaXQgdGhpcy5vYmplY3RTdHJlYW0oKSk7XG4gICAgICAgICAgICByZXR1cm4gY29udHJvbGxlci5jbG9zZSgpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtdCA9PT0gbWVzc2FnZXNfMS5NZXNzYWdlVHlwZS5TdHJlYW1IZWFkZXJUcmFjaykge1xuICAgICAgICAgICAgY29uc3QgaGVhZGVyID0gYXdhaXQgdGhpcy5zdHJlYW1IZWFkZXJUcmFjaygpO1xuICAgICAgICAgICAgdGhpcy5zdGF0ZSA9IEVuY29kZXJTdGF0ZS5UcmFja1N0cmVhbTtcbiAgICAgICAgICAgIHRoaXMuc3Vic2NyaWJlSWQgPSBoZWFkZXIuc3Vic2NyaWJlSWQ7XG4gICAgICAgICAgICB0aGlzLnRyYWNrQWxpYXMgPSBoZWFkZXIudHJhY2tBbGlhcztcbiAgICAgICAgICAgIHRoaXMucHVibGlzaGVyUHJpb3JpdHkgPSBoZWFkZXIucHVibGlzaGVyUHJpb3JpdHk7XG4gICAgICAgICAgICBjb25zdCBvID0gYXdhaXQgdGhpcy5zdHJlYW1IZWFkZXJUcmFja09iamVjdCgpO1xuICAgICAgICAgICAgcmV0dXJuIGNvbnRyb2xsZXIuZW5xdWV1ZSh7XG4gICAgICAgICAgICAgICAgdHlwZTogbWVzc2FnZXNfMS5NZXNzYWdlVHlwZS5TdHJlYW1IZWFkZXJUcmFjayxcbiAgICAgICAgICAgICAgICBzdWJzY3JpYmVJZDogdGhpcy5zdWJzY3JpYmVJZCxcbiAgICAgICAgICAgICAgICB0cmFja0FsaWFzOiB0aGlzLnRyYWNrQWxpYXMsXG4gICAgICAgICAgICAgICAgZ3JvdXBJZDogby5ncm91cElkLFxuICAgICAgICAgICAgICAgIG9iamVjdElkOiBvLm9iamVjdElkLFxuICAgICAgICAgICAgICAgIHB1Ymxpc2hlclByaW9yaXR5OiB0aGlzLnB1Ymxpc2hlclByaW9yaXR5LFxuICAgICAgICAgICAgICAgIG9iamVjdFN0YXR1czogMCxcbiAgICAgICAgICAgICAgICBvYmplY3RQYXlsb2FkOiBvLm9iamVjdFBheWxvYWQsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobXQgPT09IG1lc3NhZ2VzXzEuTWVzc2FnZVR5cGUuU3RyZWFtSGVhZGVyR3JvdXApIHtcbiAgICAgICAgICAgIGNvbnN0IGhlYWRlciA9IGF3YWl0IHRoaXMuc3RyZWFtSGVhZGVyR3JvdXAoKTtcbiAgICAgICAgICAgIHRoaXMuc3RhdGUgPSBFbmNvZGVyU3RhdGUuR3JvdXBTdHJlYW07XG4gICAgICAgICAgICB0aGlzLnN1YnNjcmliZUlkID0gaGVhZGVyLnN1YnNjcmliZUlkO1xuICAgICAgICAgICAgdGhpcy50cmFja0FsaWFzID0gaGVhZGVyLnRyYWNrQWxpYXM7XG4gICAgICAgICAgICB0aGlzLmdyb3VwSWQgPSBoZWFkZXIuZ3JvdXBJZDtcbiAgICAgICAgICAgIHRoaXMucHVibGlzaGVyUHJpb3JpdHkgPSBoZWFkZXIucHVibGlzaGVyUHJpb3JpdHk7XG4gICAgICAgICAgICBjb25zdCBvID0gYXdhaXQgdGhpcy5zdHJlYW1IZWFkZXJHcm91cE9iamVjdCgpO1xuICAgICAgICAgICAgaWYgKCFvKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGNvbnRyb2xsZXIuZW5xdWV1ZSh7XG4gICAgICAgICAgICAgICAgdHlwZTogbWVzc2FnZXNfMS5NZXNzYWdlVHlwZS5TdHJlYW1IZWFkZXJHcm91cCxcbiAgICAgICAgICAgICAgICBzdWJzY3JpYmVJZDogdGhpcy5zdWJzY3JpYmVJZCxcbiAgICAgICAgICAgICAgICB0cmFja0FsaWFzOiB0aGlzLnRyYWNrQWxpYXMsXG4gICAgICAgICAgICAgICAgZ3JvdXBJZDogdGhpcy5ncm91cElkLFxuICAgICAgICAgICAgICAgIG9iamVjdElkOiBvLm9iamVjdElkLFxuICAgICAgICAgICAgICAgIHB1Ymxpc2hlclByaW9yaXR5OiB0aGlzLnB1Ymxpc2hlclByaW9yaXR5LFxuICAgICAgICAgICAgICAgIG9iamVjdFN0YXR1czogMCxcbiAgICAgICAgICAgICAgICBvYmplY3RQYXlsb2FkOiBvLm9iamVjdFBheWxvYWQsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYHVuZXhwZWN0ZWQgbWVzc2FnZSB0eXBlOiAke210fWApO1xuICAgIH1cbn1cbmV4cG9ydHMuT2JqZWN0U3RyZWFtRGVjb2RlciA9IE9iamVjdFN0cmVhbURlY29kZXI7XG4iLCJcInVzZSBzdHJpY3RcIjtcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShleHBvcnRzLCBcIl9fZXNNb2R1bGVcIiwgeyB2YWx1ZTogdHJ1ZSB9KTtcbmV4cG9ydHMuRW5jb2RlciA9IHZvaWQgMDtcbmNvbnN0IHZhcmludF8xID0gcmVxdWlyZShcIi4vdmFyaW50XCIpO1xuY2xhc3MgRW5jb2RlciB7XG4gICAgY29uc3RydWN0b3Ioc3RyZWFtKSB7XG4gICAgICAgIHRoaXMud3JpdGVyID0gc3RyZWFtO1xuICAgIH1cbiAgICBhc3luYyB3cml0ZShjaHVuaywgXykge1xuICAgICAgICBhd2FpdCBjaHVuay5lbmNvZGUodGhpcyk7XG4gICAgfVxuICAgIGFzeW5jIHdyaXRlVmFyaW50KGkpIHtcbiAgICAgICAgY29uc3QgZGF0YSA9ICgwLCB2YXJpbnRfMS5lbmNvZGVWYXJpbnQpKGkpO1xuICAgICAgICBjb25zdCB3cml0ZXIgPSB0aGlzLndyaXRlci5nZXRXcml0ZXIoKTtcbiAgICAgICAgYXdhaXQgd3JpdGVyLndyaXRlKGRhdGEpO1xuICAgICAgICB3cml0ZXIucmVsZWFzZUxvY2soKTtcbiAgICB9XG4gICAgYXN5bmMgd3JpdGVCeXRlcyhkYXRhKSB7XG4gICAgICAgIGNvbnN0IHdyaXRlciA9IHRoaXMud3JpdGVyLmdldFdyaXRlcigpO1xuICAgICAgICBhd2FpdCB3cml0ZXIud3JpdGUoZGF0YSk7XG4gICAgICAgIHdyaXRlci5yZWxlYXNlTG9jaygpO1xuICAgIH1cbiAgICBhc3luYyB3cml0ZVN0cmluZyhzKSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUocyk7XG4gICAgICAgIGF3YWl0IHRoaXMud3JpdGVWYXJpbnQoZGF0YS5ieXRlTGVuZ3RoKTtcbiAgICAgICAgYXdhaXQgdGhpcy53cml0ZUJ5dGVzKGRhdGEpO1xuICAgIH1cbn1cbmV4cG9ydHMuRW5jb2RlciA9IEVuY29kZXI7XG4iLCJcInVzZSBzdHJpY3RcIjtcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShleHBvcnRzLCBcIl9fZXNNb2R1bGVcIiwgeyB2YWx1ZTogdHJ1ZSB9KTtcbmV4cG9ydHMuU2Vzc2lvbiA9IHZvaWQgMDtcbnZhciBzZXNzaW9uXzEgPSByZXF1aXJlKFwiLi9zZXNzaW9uXCIpO1xuT2JqZWN0LmRlZmluZVByb3BlcnR5KGV4cG9ydHMsIFwiU2Vzc2lvblwiLCB7IGVudW1lcmFibGU6IHRydWUsIGdldDogZnVuY3Rpb24gKCkgeyByZXR1cm4gc2Vzc2lvbl8xLlNlc3Npb247IH0gfSk7XG4iLCJcInVzZSBzdHJpY3RcIjtcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShleHBvcnRzLCBcIl9fZXNNb2R1bGVcIiwgeyB2YWx1ZTogdHJ1ZSB9KTtcbmV4cG9ydHMuUGFyYW1ldGVyRW5jb2RlciA9IGV4cG9ydHMuU3RyZWFtSGVhZGVyR3JvdXBPYmplY3RFbmNvZGVyID0gZXhwb3J0cy5TdHJlYW1IZWFkZXJHcm91cEVuY29kZXIgPSBleHBvcnRzLlN0cmVhbUhlYWRlclRyYWNrT2JqZWN0RW5jb2RlciA9IGV4cG9ydHMuU3RyZWFtSGVhZGVyVHJhY2tFbmNvZGVyID0gZXhwb3J0cy5TZXJ2ZXJTZXR1cEVuY29kZXIgPSBleHBvcnRzLkNsaWVudFNldHVwRW5jb2RlciA9IGV4cG9ydHMuR29Bd2F5RW5jb2RlciA9IGV4cG9ydHMuVW5hbm5vdW5jZUVuY29kZXIgPSBleHBvcnRzLkFubm91bmNlRXJyb3JFbmNvZGVyID0gZXhwb3J0cy5Bbm5vdW5jZU9rRW5jb2RlciA9IGV4cG9ydHMuQW5ub3VuY2VFbmNvZGVyID0gZXhwb3J0cy5TdWJzY3JpYmVEb25lRW5jb2RlciA9IGV4cG9ydHMuVW5zdWJzY3JpYmVFbmNvZGVyID0gZXhwb3J0cy5TdWJzY3JpYmVFcnJvckVuY29kZXIgPSBleHBvcnRzLlN1YnNjcmliZU9rRW5jb2RlciA9IGV4cG9ydHMuU3Vic2NyaWJlVXBkYXRlRW5jb2RlciA9IGV4cG9ydHMuU3Vic2NyaWJlRW5jb2RlciA9IGV4cG9ydHMuRmlsdGVyVHlwZSA9IGV4cG9ydHMuT2JqZWN0U3RyZWFtRW5jb2RlciA9IGV4cG9ydHMuTWVzc2FnZVR5cGUgPSBleHBvcnRzLkNVUlJFTlRfU1VQUE9SVEVEX0RSQUZUID0gZXhwb3J0cy5EUkFGVF9JRVRGX01PUV9UUkFOU1BPUlRfMDUgPSBleHBvcnRzLkRSQUZUX0lFVEZfTU9RX1RSQU5TUE9SVF8wNCA9IGV4cG9ydHMuRFJBRlRfSUVURl9NT1FfVFJBTlNQT1JUXzAzID0gZXhwb3J0cy5EUkFGVF9JRVRGX01PUV9UUkFOU1BPUlRfMDIgPSBleHBvcnRzLkRSQUZUX0lFVEZfTU9RX1RSQU5TUE9SVF8wMSA9IHZvaWQgMDtcbmV4cG9ydHMuRFJBRlRfSUVURl9NT1FfVFJBTlNQT1JUXzAxID0gMHhmZjAwMDAwMTtcbmV4cG9ydHMuRFJBRlRfSUVURl9NT1FfVFJBTlNQT1JUXzAyID0gMHhmZjAwMDAwMjtcbmV4cG9ydHMuRFJBRlRfSUVURl9NT1FfVFJBTlNQT1JUXzAzID0gMHhmZjAwMDAwMztcbmV4cG9ydHMuRFJBRlRfSUVURl9NT1FfVFJBTlNQT1JUXzA0ID0gMHhmZjAwMDAwNDtcbmV4cG9ydHMuRFJBRlRfSUVURl9NT1FfVFJBTlNQT1JUXzA1ID0gMHhmZjAwMDAwNTtcbmV4cG9ydHMuQ1VSUkVOVF9TVVBQT1JURURfRFJBRlQgPSBleHBvcnRzLkRSQUZUX0lFVEZfTU9RX1RSQU5TUE9SVF8wMztcbnZhciBNZXNzYWdlVHlwZTtcbihmdW5jdGlvbiAoTWVzc2FnZVR5cGUpIHtcbiAgICBNZXNzYWdlVHlwZVtNZXNzYWdlVHlwZVtcIk9iamVjdFN0cmVhbVwiXSA9IDBdID0gXCJPYmplY3RTdHJlYW1cIjtcbiAgICBNZXNzYWdlVHlwZVtNZXNzYWdlVHlwZVtcIk9iamVjdERhdGFncmFtXCJdID0gMV0gPSBcIk9iamVjdERhdGFncmFtXCI7XG4gICAgTWVzc2FnZVR5cGVbTWVzc2FnZVR5cGVbXCJTdWJzY3JpYmVVcGRhdGVcIl0gPSAyXSA9IFwiU3Vic2NyaWJlVXBkYXRlXCI7XG4gICAgTWVzc2FnZVR5cGVbTWVzc2FnZVR5cGVbXCJTdWJzY3JpYmVcIl0gPSAzXSA9IFwiU3Vic2NyaWJlXCI7XG4gICAgTWVzc2FnZVR5cGVbTWVzc2FnZVR5cGVbXCJTdWJzY3JpYmVPa1wiXSA9IDRdID0gXCJTdWJzY3JpYmVPa1wiO1xuICAgIE1lc3NhZ2VUeXBlW01lc3NhZ2VUeXBlW1wiU3Vic2NyaWJlRXJyb3JcIl0gPSA1XSA9IFwiU3Vic2NyaWJlRXJyb3JcIjtcbiAgICBNZXNzYWdlVHlwZVtNZXNzYWdlVHlwZVtcIkFubm91bmNlXCJdID0gNl0gPSBcIkFubm91bmNlXCI7XG4gICAgTWVzc2FnZVR5cGVbTWVzc2FnZVR5cGVbXCJBbm5vdW5jZU9rXCJdID0gN10gPSBcIkFubm91bmNlT2tcIjtcbiAgICBNZXNzYWdlVHlwZVtNZXNzYWdlVHlwZVtcIkFubm91bmNlRXJyb3JcIl0gPSA4XSA9IFwiQW5ub3VuY2VFcnJvclwiO1xuICAgIE1lc3NhZ2VUeXBlW01lc3NhZ2VUeXBlW1wiVW5hbm5vdW5jZVwiXSA9IDldID0gXCJVbmFubm91bmNlXCI7XG4gICAgTWVzc2FnZVR5cGVbTWVzc2FnZVR5cGVbXCJVbnN1YnNjcmliZVwiXSA9IDEwXSA9IFwiVW5zdWJzY3JpYmVcIjtcbiAgICBNZXNzYWdlVHlwZVtNZXNzYWdlVHlwZVtcIlN1YnNjcmliZURvbmVcIl0gPSAxMV0gPSBcIlN1YnNjcmliZURvbmVcIjtcbiAgICBNZXNzYWdlVHlwZVtNZXNzYWdlVHlwZVtcIkFubm91bmNlQ2FuY2VsXCJdID0gMTJdID0gXCJBbm5vdW5jZUNhbmNlbFwiO1xuICAgIE1lc3NhZ2VUeXBlW01lc3NhZ2VUeXBlW1wiR29Bd2F5XCJdID0gMTZdID0gXCJHb0F3YXlcIjtcbiAgICBNZXNzYWdlVHlwZVtNZXNzYWdlVHlwZVtcIkNsaWVudFNldHVwXCJdID0gNjRdID0gXCJDbGllbnRTZXR1cFwiO1xuICAgIE1lc3NhZ2VUeXBlW01lc3NhZ2VUeXBlW1wiU2VydmVyU2V0dXBcIl0gPSA2NV0gPSBcIlNlcnZlclNldHVwXCI7XG4gICAgTWVzc2FnZVR5cGVbTWVzc2FnZVR5cGVbXCJTdHJlYW1IZWFkZXJUcmFja1wiXSA9IDgwXSA9IFwiU3RyZWFtSGVhZGVyVHJhY2tcIjtcbiAgICBNZXNzYWdlVHlwZVtNZXNzYWdlVHlwZVtcIlN0cmVhbUhlYWRlckdyb3VwXCJdID0gODFdID0gXCJTdHJlYW1IZWFkZXJHcm91cFwiO1xufSkoTWVzc2FnZVR5cGUgfHwgKGV4cG9ydHMuTWVzc2FnZVR5cGUgPSBNZXNzYWdlVHlwZSA9IHt9KSk7XG5jbGFzcyBPYmplY3RTdHJlYW1FbmNvZGVyIHtcbiAgICBjb25zdHJ1Y3RvcihtKSB7XG4gICAgICAgIE9iamVjdC5hc3NpZ24odGhpcywgbSk7XG4gICAgfVxuICAgIGFzeW5jIGVuY29kZShlKSB7XG4gICAgICAgIGlmICh0aGlzLnR5cGUgPT09IE1lc3NhZ2VUeXBlLk9iamVjdFN0cmVhbSB8fCB0aGlzLnR5cGUgPT09IE1lc3NhZ2VUeXBlLk9iamVjdERhdGFncmFtKSB7XG4gICAgICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMudHlwZSk7XG4gICAgICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMuc3Vic2NyaWJlSWQpO1xuICAgICAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLnRyYWNrQWxpYXMpO1xuICAgICAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLmdyb3VwSWQpO1xuICAgICAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLm9iamVjdElkKTtcbiAgICAgICAgICAgIGF3YWl0IGUud3JpdGVCeXRlcyhuZXcgVWludDhBcnJheShbdGhpcy5wdWJsaXNoZXJQcmlvcml0eV0pKTtcbiAgICAgICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy5vYmplY3RTdGF0dXMpO1xuICAgICAgICAgICAgYXdhaXQgZS53cml0ZUJ5dGVzKHRoaXMub2JqZWN0UGF5bG9hZCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMudHlwZSA9PT0gTWVzc2FnZVR5cGUuU3RyZWFtSGVhZGVyVHJhY2spIHtcbiAgICAgICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy5ncm91cElkKTtcbiAgICAgICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy5vYmplY3RJZCk7XG4gICAgICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMub2JqZWN0UGF5bG9hZC5sZW5ndGgpO1xuICAgICAgICAgICAgaWYgKHRoaXMub2JqZWN0UGF5bG9hZC5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMub2JqZWN0U3RhdHVzKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBhd2FpdCBlLndyaXRlQnl0ZXModGhpcy5vYmplY3RQYXlsb2FkKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy50eXBlID09PSBNZXNzYWdlVHlwZS5TdHJlYW1IZWFkZXJHcm91cCkge1xuICAgICAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLm9iamVjdElkKTtcbiAgICAgICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy5vYmplY3RQYXlsb2FkLmxlbmd0aCk7XG4gICAgICAgICAgICBpZiAodGhpcy5vYmplY3RQYXlsb2FkLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy5vYmplY3RTdGF0dXMpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGF3YWl0IGUud3JpdGVCeXRlcyh0aGlzLm9iamVjdFBheWxvYWQpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgY2Fubm90IGVuY29kZSB1bmtub3duIG1lc3NhZ2UgdHlwZSAke3RoaXMudHlwZX1gKTtcbiAgICB9XG59XG5leHBvcnRzLk9iamVjdFN0cmVhbUVuY29kZXIgPSBPYmplY3RTdHJlYW1FbmNvZGVyO1xudmFyIEZpbHRlclR5cGU7XG4oZnVuY3Rpb24gKEZpbHRlclR5cGUpIHtcbiAgICBGaWx0ZXJUeXBlW0ZpbHRlclR5cGVbXCJMYXRlc3RHcm91cFwiXSA9IDFdID0gXCJMYXRlc3RHcm91cFwiO1xuICAgIEZpbHRlclR5cGVbRmlsdGVyVHlwZVtcIkxhdGVzdE9iamVjdFwiXSA9IDJdID0gXCJMYXRlc3RPYmplY3RcIjtcbiAgICBGaWx0ZXJUeXBlW0ZpbHRlclR5cGVbXCJBYnNvbHV0ZVN0YXJ0XCJdID0gM10gPSBcIkFic29sdXRlU3RhcnRcIjtcbiAgICBGaWx0ZXJUeXBlW0ZpbHRlclR5cGVbXCJBYnNvbHV0ZVJhbmdlXCJdID0gNF0gPSBcIkFic29sdXRlUmFuZ2VcIjtcbn0pKEZpbHRlclR5cGUgfHwgKGV4cG9ydHMuRmlsdGVyVHlwZSA9IEZpbHRlclR5cGUgPSB7fSkpO1xuY2xhc3MgU3Vic2NyaWJlRW5jb2RlciB7XG4gICAgY29uc3RydWN0b3IobSkge1xuICAgICAgICBPYmplY3QuYXNzaWduKHRoaXMsIG0pO1xuICAgIH1cbiAgICBhc3luYyBlbmNvZGUoZSkge1xuICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMudHlwZSk7XG4gICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy5zdWJzY3JpYmVJZCk7XG4gICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy50cmFja0FsaWFzKTtcbiAgICAgICAgYXdhaXQgZS53cml0ZVN0cmluZyh0aGlzLnRyYWNrTmFtZXNwYWNlKTtcbiAgICAgICAgYXdhaXQgZS53cml0ZVN0cmluZyh0aGlzLnRyYWNrTmFtZSk7XG4gICAgICAgIGF3YWl0IGUud3JpdGVCeXRlcyhuZXcgVWludDhBcnJheShbdGhpcy5zdWJzY3JpYmVyUHJpb3JpdHldKSk7XG4gICAgICAgIGF3YWl0IGUud3JpdGVCeXRlcyhuZXcgVWludDhBcnJheShbdGhpcy5ncm91cE9yZGVyXSkpO1xuICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMuZmlsdGVyVHlwZSk7XG4gICAgICAgIGlmICh0aGlzLmZpbHRlclR5cGUgPT09IEZpbHRlclR5cGUuQWJzb2x1dGVTdGFydCB8fFxuICAgICAgICAgICAgdGhpcy5maWx0ZXJUeXBlID09PSBGaWx0ZXJUeXBlLkFic29sdXRlUmFuZ2UpIHtcbiAgICAgICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy5zdGFydEdyb3VwIHx8IDApO1xuICAgICAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLnN0YXJ0T2JqZWN0IHx8IDApO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLmZpbHRlclR5cGUgPT09IEZpbHRlclR5cGUuQWJzb2x1dGVSYW5nZSkge1xuICAgICAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLmVuZEdyb3VwIHx8IDApO1xuICAgICAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLmVuZE9iamVjdCB8fCAwKTtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMuc3Vic2NyaWJlUGFyYW1ldGVycy5sZW5ndGgpO1xuICAgICAgICBmb3IgKGNvbnN0IHAgb2YgdGhpcy5zdWJzY3JpYmVQYXJhbWV0ZXJzKSB7XG4gICAgICAgICAgICBhd2FpdCBuZXcgUGFyYW1ldGVyRW5jb2RlcihwKS5lbmNvZGUoZSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5leHBvcnRzLlN1YnNjcmliZUVuY29kZXIgPSBTdWJzY3JpYmVFbmNvZGVyO1xuY2xhc3MgU3Vic2NyaWJlVXBkYXRlRW5jb2RlciB7XG4gICAgY29uc3RydWN0b3IobSkge1xuICAgICAgICBPYmplY3QuYXNzaWduKHRoaXMsIG0pO1xuICAgIH1cbiAgICBhc3luYyBlbmNvZGUoZSkge1xuICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMudHlwZSk7XG4gICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy5zdWJzY3JpYmVJZCk7XG4gICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy5zdGFydEdyb3VwKTtcbiAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLnN0YXJ0T2JqZWN0KTtcbiAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLmVuZEdyb3VwKTtcbiAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLmVuZE9iamVjdCk7XG4gICAgICAgIGF3YWl0IGUud3JpdGVCeXRlcyhuZXcgVWludDhBcnJheShbdGhpcy5zdWJzY3JpYmVyUHJpb3JpdHldKSk7XG4gICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy5zdWJzY3JpYmVQYXJhbWV0ZXJzLmxlbmd0aCk7XG4gICAgICAgIGZvciAoY29uc3QgcCBvZiB0aGlzLnN1YnNjcmliZVBhcmFtZXRlcnMpIHtcbiAgICAgICAgICAgIGF3YWl0IG5ldyBQYXJhbWV0ZXJFbmNvZGVyKHApLmVuY29kZShlKTtcbiAgICAgICAgfVxuICAgIH1cbn1cbmV4cG9ydHMuU3Vic2NyaWJlVXBkYXRlRW5jb2RlciA9IFN1YnNjcmliZVVwZGF0ZUVuY29kZXI7XG5jbGFzcyBTdWJzY3JpYmVPa0VuY29kZXIge1xuICAgIGNvbnN0cnVjdG9yKG0pIHtcbiAgICAgICAgT2JqZWN0LmFzc2lnbih0aGlzLCBtKTtcbiAgICB9XG4gICAgYXN5bmMgZW5jb2RlKGUpIHtcbiAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLnR5cGUpO1xuICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMuc3Vic2NyaWJlSWQpO1xuICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMuZXhwaXJlcyk7XG4gICAgICAgIGF3YWl0IGUud3JpdGVCeXRlcyhuZXcgVWludDhBcnJheShbdGhpcy5ncm91cE9yZGVyXSkpO1xuICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMuY29udGVudEV4aXN0cyA/IDEgOiAwKTsgLy8gVE9ETzogU2hvdWxkIHVzZSBieXRlIGluc3RlYWQgb2YgdmFyaW50P1xuICAgICAgICBpZiAodGhpcy5jb250ZW50RXhpc3RzKSB7XG4gICAgICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMuZmluYWxHcm91cCk7XG4gICAgICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMuZmluYWxPYmplY3QpO1xuICAgICAgICB9XG4gICAgfVxufVxuZXhwb3J0cy5TdWJzY3JpYmVPa0VuY29kZXIgPSBTdWJzY3JpYmVPa0VuY29kZXI7XG5jbGFzcyBTdWJzY3JpYmVFcnJvckVuY29kZXIge1xuICAgIGNvbnN0cnVjdG9yKG0pIHtcbiAgICAgICAgT2JqZWN0LmFzc2lnbih0aGlzLCBtKTtcbiAgICB9XG4gICAgYXN5bmMgZW5jb2RlKGUpIHtcbiAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLnR5cGUpO1xuICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMuc3Vic2NyaWJlSWQpO1xuICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMuZXJyb3JDb2RlKTtcbiAgICAgICAgYXdhaXQgZS53cml0ZVN0cmluZyh0aGlzLnJlYXNvblBocmFzZSk7XG4gICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy50cmFja0FsaWFzKTtcbiAgICB9XG59XG5leHBvcnRzLlN1YnNjcmliZUVycm9yRW5jb2RlciA9IFN1YnNjcmliZUVycm9yRW5jb2RlcjtcbmNsYXNzIFVuc3Vic2NyaWJlRW5jb2RlciB7XG4gICAgY29uc3RydWN0b3IobSkge1xuICAgICAgICBPYmplY3QuYXNzaWduKHRoaXMsIG0pO1xuICAgIH1cbiAgICBhc3luYyBlbmNvZGUoZSkge1xuICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMudHlwZSk7XG4gICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy5zdWJzY3JpYmVJZCk7XG4gICAgfVxufVxuZXhwb3J0cy5VbnN1YnNjcmliZUVuY29kZXIgPSBVbnN1YnNjcmliZUVuY29kZXI7XG5jbGFzcyBTdWJzY3JpYmVEb25lRW5jb2RlciB7XG4gICAgY29uc3RydWN0b3IobSkge1xuICAgICAgICBPYmplY3QuYXNzaWduKHRoaXMsIG0pO1xuICAgIH1cbiAgICBhc3luYyBlbmNvZGUoZSkge1xuICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMudHlwZSk7XG4gICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy5zdWJzY3JpYmVJZCk7XG4gICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy5zdGF0dXNDb2RlKTtcbiAgICAgICAgYXdhaXQgZS53cml0ZVN0cmluZyh0aGlzLnJlYXNvblBocmFzZSk7XG4gICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy5jb250ZW50RXhpc3RzID8gMSA6IDApOyAvLyBUT0RPOiBTaG91bGQgdXNlIGJ5dGUgaW5zdGVhZCBvZiB2YXJpbnQ/XG4gICAgICAgIGlmICh0aGlzLmNvbnRlbnRFeGlzdHMpIHtcbiAgICAgICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy5maW5hbEdyb3VwIHx8IDApO1xuICAgICAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLmZpbmFsT2JqZWN0IHx8IDApO1xuICAgICAgICB9XG4gICAgfVxufVxuZXhwb3J0cy5TdWJzY3JpYmVEb25lRW5jb2RlciA9IFN1YnNjcmliZURvbmVFbmNvZGVyO1xuY2xhc3MgQW5ub3VuY2VFbmNvZGVyIHtcbiAgICBjb25zdHJ1Y3RvcihtKSB7XG4gICAgICAgIE9iamVjdC5hc3NpZ24odGhpcywgbSk7XG4gICAgfVxuICAgIGFzeW5jIGVuY29kZShlKSB7XG4gICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy50eXBlKTtcbiAgICAgICAgYXdhaXQgZS53cml0ZVN0cmluZyh0aGlzLm5hbWVzcGFjZSk7XG4gICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy5wYXJhbWV0ZXJzLmxlbmd0aCk7XG4gICAgICAgIGZvciAoY29uc3QgcCBvZiB0aGlzLnBhcmFtZXRlcnMpIHtcbiAgICAgICAgICAgIGF3YWl0IG5ldyBQYXJhbWV0ZXJFbmNvZGVyKHApLmVuY29kZShlKTtcbiAgICAgICAgfVxuICAgIH1cbn1cbmV4cG9ydHMuQW5ub3VuY2VFbmNvZGVyID0gQW5ub3VuY2VFbmNvZGVyO1xuY2xhc3MgQW5ub3VuY2VPa0VuY29kZXIge1xuICAgIGNvbnN0cnVjdG9yKG0pIHtcbiAgICAgICAgT2JqZWN0LmFzc2lnbih0aGlzLCBtKTtcbiAgICB9XG4gICAgYXN5bmMgZW5jb2RlKGUpIHtcbiAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLnR5cGUpO1xuICAgICAgICBhd2FpdCBlLndyaXRlU3RyaW5nKHRoaXMudHJhY2tOYW1lc3BhY2UpO1xuICAgIH1cbn1cbmV4cG9ydHMuQW5ub3VuY2VPa0VuY29kZXIgPSBBbm5vdW5jZU9rRW5jb2RlcjtcbmNsYXNzIEFubm91bmNlRXJyb3JFbmNvZGVyIHtcbiAgICBjb25zdHJ1Y3RvcihtKSB7XG4gICAgICAgIE9iamVjdC5hc3NpZ24odGhpcywgbSk7XG4gICAgfVxuICAgIGFzeW5jIGVuY29kZShlKSB7XG4gICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy50eXBlKTtcbiAgICAgICAgYXdhaXQgZS53cml0ZVN0cmluZyh0aGlzLnRyYWNrTmFtZXNwYWNlKTtcbiAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLmVycm9yQ29kZSk7XG4gICAgICAgIGF3YWl0IGUud3JpdGVTdHJpbmcodGhpcy5yZWFzb25QaHJhc2UpO1xuICAgIH1cbn1cbmV4cG9ydHMuQW5ub3VuY2VFcnJvckVuY29kZXIgPSBBbm5vdW5jZUVycm9yRW5jb2RlcjtcbmNsYXNzIFVuYW5ub3VuY2VFbmNvZGVyIHtcbiAgICBjb25zdHJ1Y3RvcihtKSB7XG4gICAgICAgIE9iamVjdC5hc3NpZ24odGhpcywgbSk7XG4gICAgfVxuICAgIGFzeW5jIGVuY29kZShlKSB7XG4gICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy50eXBlKTtcbiAgICAgICAgYXdhaXQgZS53cml0ZVN0cmluZyh0aGlzLnRyYWNrTmFtZXNwYWNlKTtcbiAgICB9XG59XG5leHBvcnRzLlVuYW5ub3VuY2VFbmNvZGVyID0gVW5hbm5vdW5jZUVuY29kZXI7XG5jbGFzcyBHb0F3YXlFbmNvZGVyIHtcbiAgICBjb25zdHJ1Y3RvcihtKSB7XG4gICAgICAgIE9iamVjdC5hc3NpZ24odGhpcywgbSk7XG4gICAgfVxuICAgIGFzeW5jIGVuY29kZShlKSB7XG4gICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy50eXBlKTtcbiAgICAgICAgYXdhaXQgZS53cml0ZVN0cmluZyh0aGlzLm5ld1Nlc3Npb25VUkkpO1xuICAgIH1cbn1cbmV4cG9ydHMuR29Bd2F5RW5jb2RlciA9IEdvQXdheUVuY29kZXI7XG5jbGFzcyBDbGllbnRTZXR1cEVuY29kZXIge1xuICAgIGNvbnN0cnVjdG9yKGNzKSB7XG4gICAgICAgIE9iamVjdC5hc3NpZ24odGhpcywgY3MpO1xuICAgIH1cbiAgICBhc3luYyBlbmNvZGUoZSkge1xuICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMudHlwZSk7XG4gICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy52ZXJzaW9ucy5sZW5ndGgpO1xuICAgICAgICBmb3IgKGNvbnN0IHYgb2YgdGhpcy52ZXJzaW9ucykge1xuICAgICAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh2KTtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMucGFyYW1ldGVycy5sZW5ndGgpO1xuICAgICAgICBmb3IgKGNvbnN0IHAgb2YgdGhpcy5wYXJhbWV0ZXJzKSB7XG4gICAgICAgICAgICBhd2FpdCBuZXcgUGFyYW1ldGVyRW5jb2RlcihwKS5lbmNvZGUoZSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5leHBvcnRzLkNsaWVudFNldHVwRW5jb2RlciA9IENsaWVudFNldHVwRW5jb2RlcjtcbmNsYXNzIFNlcnZlclNldHVwRW5jb2RlciB7XG4gICAgY29uc3RydWN0b3IobSkge1xuICAgICAgICBPYmplY3QuYXNzaWduKHRoaXMsIG0pO1xuICAgIH1cbn1cbmV4cG9ydHMuU2VydmVyU2V0dXBFbmNvZGVyID0gU2VydmVyU2V0dXBFbmNvZGVyO1xuY2xhc3MgU3RyZWFtSGVhZGVyVHJhY2tFbmNvZGVyIHtcbiAgICBjb25zdHJ1Y3RvcihtKSB7XG4gICAgICAgIE9iamVjdC5hc3NpZ24odGhpcywgbSk7XG4gICAgfVxuICAgIGFzeW5jIGVuY29kZShlKSB7XG4gICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy50eXBlKTtcbiAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLnN1YnNjcmliZUlkKTtcbiAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLnRyYWNrQWxpYXMpO1xuICAgICAgICBhd2FpdCBlLndyaXRlQnl0ZXMobmV3IFVpbnQ4QXJyYXkoW3RoaXMucHVibGlzaGVyUHJpb3JpdHldKSk7XG4gICAgfVxufVxuZXhwb3J0cy5TdHJlYW1IZWFkZXJUcmFja0VuY29kZXIgPSBTdHJlYW1IZWFkZXJUcmFja0VuY29kZXI7XG5jbGFzcyBTdHJlYW1IZWFkZXJUcmFja09iamVjdEVuY29kZXIge1xuICAgIGNvbnN0cnVjdG9yKG0pIHtcbiAgICAgICAgT2JqZWN0LmFzc2lnbih0aGlzLCBtKTtcbiAgICB9XG4gICAgYXN5bmMgZW5jb2RlKGUpIHtcbiAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLmdyb3VwSWQpO1xuICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMub2JqZWN0SWQpO1xuICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMub2JqZWN0UGF5bG9hZC5ieXRlTGVuZ3RoKTtcbiAgICAgICAgaWYgKHRoaXMub2JqZWN0UGF5bG9hZC5ieXRlTGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMub2JqZWN0U3RhdHVzIHx8IDApO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgYXdhaXQgZS53cml0ZUJ5dGVzKHRoaXMub2JqZWN0UGF5bG9hZCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5leHBvcnRzLlN0cmVhbUhlYWRlclRyYWNrT2JqZWN0RW5jb2RlciA9IFN0cmVhbUhlYWRlclRyYWNrT2JqZWN0RW5jb2RlcjtcbmNsYXNzIFN0cmVhbUhlYWRlckdyb3VwRW5jb2RlciB7XG4gICAgY29uc3RydWN0b3IobSkge1xuICAgICAgICBPYmplY3QuYXNzaWduKHRoaXMsIG0pO1xuICAgIH1cbiAgICBhc3luYyBlbmNvZGUoZSkge1xuICAgICAgICBhd2FpdCBlLndyaXRlVmFyaW50KHRoaXMudHlwZSk7XG4gICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy5zdWJzY3JpYmVJZCk7XG4gICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy50cmFja0FsaWFzKTtcbiAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLmdyb3VwSWQpO1xuICAgICAgICBhd2FpdCBlLndyaXRlQnl0ZXMobmV3IFVpbnQ4QXJyYXkoW3RoaXMucHVibGlzaGVyUHJpb3JpdHldKSk7XG4gICAgfVxufVxuZXhwb3J0cy5TdHJlYW1IZWFkZXJHcm91cEVuY29kZXIgPSBTdHJlYW1IZWFkZXJHcm91cEVuY29kZXI7XG5jbGFzcyBTdHJlYW1IZWFkZXJHcm91cE9iamVjdEVuY29kZXIge1xuICAgIGNvbnN0cnVjdG9yKG0pIHtcbiAgICAgICAgT2JqZWN0LmFzc2lnbih0aGlzLCBtKTtcbiAgICB9XG4gICAgYXN5bmMgZW5jb2RlKGUpIHtcbiAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLm9iamVjdElkKTtcbiAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLm9iamVjdFBheWxvYWQuYnl0ZUxlbmd0aCk7XG4gICAgICAgIGlmICh0aGlzLm9iamVjdFBheWxvYWQuYnl0ZUxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLm9iamVjdFN0YXR1cyB8fCAwKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGF3YWl0IGUud3JpdGVCeXRlcyh0aGlzLm9iamVjdFBheWxvYWQpO1xuICAgICAgICB9XG4gICAgfVxufVxuZXhwb3J0cy5TdHJlYW1IZWFkZXJHcm91cE9iamVjdEVuY29kZXIgPSBTdHJlYW1IZWFkZXJHcm91cE9iamVjdEVuY29kZXI7XG5jbGFzcyBQYXJhbWV0ZXJFbmNvZGVyIHtcbiAgICBjb25zdHJ1Y3RvcihwKSB7XG4gICAgICAgIE9iamVjdC5hc3NpZ24odGhpcywgcCk7XG4gICAgfVxuICAgIGFzeW5jIGVuY29kZShlKSB7XG4gICAgICAgIGF3YWl0IGUud3JpdGVWYXJpbnQodGhpcy50eXBlKTtcbiAgICAgICAgYXdhaXQgZS53cml0ZVZhcmludCh0aGlzLnZhbHVlLmJ5dGVMZW5ndGgpO1xuICAgICAgICBhd2FpdCBlLndyaXRlQnl0ZXModGhpcy52YWx1ZSk7XG4gICAgfVxufVxuZXhwb3J0cy5QYXJhbWV0ZXJFbmNvZGVyID0gUGFyYW1ldGVyRW5jb2RlcjtcbiIsIlwidXNlIHN0cmljdFwiO1xuT2JqZWN0LmRlZmluZVByb3BlcnR5KGV4cG9ydHMsIFwiX19lc01vZHVsZVwiLCB7IHZhbHVlOiB0cnVlIH0pO1xuZXhwb3J0cy5TZXNzaW9uID0gdm9pZCAwO1xuY29uc3QgY29udHJvbF9zdHJlYW1fMSA9IHJlcXVpcmUoXCIuL2NvbnRyb2xfc3RyZWFtXCIpO1xuY29uc3QgZGVjb2Rlcl8xID0gcmVxdWlyZShcIi4vZGVjb2RlclwiKTtcbmNvbnN0IGVuY29kZXJfMSA9IHJlcXVpcmUoXCIuL2VuY29kZXJcIik7XG5jb25zdCBtZXNzYWdlc18xID0gcmVxdWlyZShcIi4vbWVzc2FnZXNcIik7XG5jb25zdCBzdWJzY3JpcHRpb25fMSA9IHJlcXVpcmUoXCIuL3N1YnNjcmlwdGlvblwiKTtcbmZ1bmN0aW9uIGJhc2U2NFRvQXJyYXlCdWZmZXIoYmFzZTY0KSB7XG4gICAgY29uc3QgYmluYXJ5U3RyaW5nID0gYXRvYihiYXNlNjQpO1xuICAgIGNvbnN0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYmluYXJ5U3RyaW5nLmxlbmd0aCk7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBiaW5hcnlTdHJpbmcubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgYnl0ZXNbaV0gPSBiaW5hcnlTdHJpbmcuY2hhckNvZGVBdChpKTtcbiAgICB9XG4gICAgcmV0dXJuIGJ5dGVzLmJ1ZmZlcjtcbn1cbmNsYXNzIFNlc3Npb24ge1xuICAgIGNvbnN0cnVjdG9yKGNvbm4sIGNzKSB7XG4gICAgICAgIHRoaXMubmV4dFN1YnNjcmliZUlkID0gMDtcbiAgICAgICAgdGhpcy5zdWJzY3JpcHRpb25zID0gbmV3IE1hcCgpO1xuICAgICAgICB0aGlzLmNvbm4gPSBjb25uO1xuICAgICAgICB0aGlzLmNvbnRyb2xTdHJlYW0gPSBjcztcbiAgICAgICAgY3Mub25tZXNzYWdlID0gdGhpcy5oYW5kbGUuYmluZCh0aGlzKTtcbiAgICAgICAgdGhpcy5jb250cm9sU3RyZWFtLnJ1blJlYWRMb29wKCk7XG4gICAgICAgIHRoaXMucmVhZEluY29taW5nVW5pZGlyZWN0aW9uYWxTdHJlYW1zKHRoaXMuY29ubik7XG4gICAgfVxuICAgIHN0YXRpYyBhc3luYyBjb25uZWN0KHVybCwgc2VydmVyQ2VydGlmaWNhdGVIYXNoKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKFwiY29ubmVjdGluZyBXZWJUcmFuc3BvcnRcIik7XG4gICAgICAgIGxldCBjb25uO1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgaWYgKHNlcnZlckNlcnRpZmljYXRlSGFzaCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgY2VydEhhc2hlcyA9IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgYWxnb3JpdGhtOiBcInNoYS0yNTZcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbHVlOiBiYXNlNjRUb0FycmF5QnVmZmVyKHNlcnZlckNlcnRpZmljYXRlSGFzaCksXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhcImhhc2hlc1wiLCBjZXJ0SGFzaGVzKTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhcInVybFwiLCB1cmwpO1xuICAgICAgICAgICAgICAgIGNvbm4gPSBuZXcgV2ViVHJhbnNwb3J0KHVybCwgeyBzZXJ2ZXJDZXJ0aWZpY2F0ZUhhc2hlczogY2VydEhhc2hlcyB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiY29ubmVjdGluZyB3aXRob3V0IHNlcnZlckNlcnRpZmljYXRlSGFzaGVzXCIpO1xuICAgICAgICAgICAgICAgIGNvbm4gPSBuZXcgV2ViVHJhbnNwb3J0KHVybCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYGZhaWxlZCB0byBjb25uZWN0IE1vUSBzZXNzaW9uOiAke2Vycm9yfWApO1xuICAgICAgICB9XG4gICAgICAgIGF3YWl0IGNvbm4ucmVhZHk7XG4gICAgICAgIGNvbnNvbGUubG9nKFwiV2ViVHJhbnNwb3J0IGNvbm5lY3Rpb24gcmVhZHlcIik7XG4gICAgICAgIGNvbnN0IGNzID0gYXdhaXQgY29ubi5jcmVhdGVCaWRpcmVjdGlvbmFsU3RyZWFtKCk7XG4gICAgICAgIGNvbnN0IGRlY29kZXJTdHJlYW0gPSBuZXcgUmVhZGFibGVTdHJlYW0obmV3IGRlY29kZXJfMS5Db250cm9sU3RyZWFtRGVjb2Rlcihjcy5yZWFkYWJsZSkpO1xuICAgICAgICBjb25zdCBlbmNvZGVyU3RyZWFtID0gbmV3IFdyaXRhYmxlU3RyZWFtKG5ldyBlbmNvZGVyXzEuRW5jb2Rlcihjcy53cml0YWJsZSkpO1xuICAgICAgICBjb25zdCBjb250cm9sU3RyZWFtID0gbmV3IGNvbnRyb2xfc3RyZWFtXzEuQ29udHJvbFN0cmVhbShkZWNvZGVyU3RyZWFtLCBlbmNvZGVyU3RyZWFtKTtcbiAgICAgICAgYXdhaXQgY29udHJvbFN0cmVhbS5oYW5kc2hha2UoKTtcbiAgICAgICAgY29uc29sZS5sb2coXCJoYW5kc2hha2UgZG9uZVwiKTtcbiAgICAgICAgcmV0dXJuIG5ldyBTZXNzaW9uKGNvbm4sIGNvbnRyb2xTdHJlYW0pO1xuICAgIH1cbiAgICBhc3luYyByZWFkSW5jb21pbmdVbmlkaXJlY3Rpb25hbFN0cmVhbXMoY29ubikge1xuICAgICAgICBjb25zb2xlLmxvZyhcInJlYWRpbmcgaW5jb21pbmcgc3RyZWFtc1wiKTtcbiAgICAgICAgY29uc3QgdWRzID0gY29ubi5pbmNvbWluZ1VuaWRpcmVjdGlvbmFsU3RyZWFtcztcbiAgICAgICAgY29uc3QgcmVhZGVyID0gdWRzLmdldFJlYWRlcigpO1xuICAgICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICAgICAgY29uc3QgeyBkb25lLCB2YWx1ZSB9ID0gYXdhaXQgcmVhZGVyLnJlYWQoKTtcbiAgICAgICAgICAgIGlmIChkb25lKSB7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLnJlYWRJbmNvbWluZ1VuaVN0cmVhbSh2YWx1ZSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgLy8gQHRzLWlnbm9yZVxuICAgIGFzeW5jIHJlYWRJbmNvbWluZ1VuaVN0cmVhbShzdHJlYW0pIHtcbiAgICAgICAgY29uc29sZS5sb2coXCJnb3Qgc3RyZWFtXCIpO1xuICAgICAgICBjb25zdCBtZXNzYWdlU3RyZWFtID0gbmV3IFJlYWRhYmxlU3RyZWFtKG5ldyBkZWNvZGVyXzEuT2JqZWN0U3RyZWFtRGVjb2RlcihzdHJlYW0pKTtcbiAgICAgICAgY29uc3QgcmVhZGVyID0gbWVzc2FnZVN0cmVhbS5nZXRSZWFkZXIoKTtcbiAgICAgICAgZm9yICg7Oykge1xuICAgICAgICAgICAgY29uc3QgeyB2YWx1ZSwgZG9uZSB9ID0gYXdhaXQgcmVhZGVyLnJlYWQoKTtcbiAgICAgICAgICAgIGlmIChkb25lKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coXCJzdHJlYW0gY2xvc2VkXCIpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gY29uc29sZS5sb2coXCJnb3Qgb2JqZWN0XCIsIHZhbHVlKTtcbiAgICAgICAgICAgIGlmICghdGhpcy5zdWJzY3JpcHRpb25zLmhhcyh2YWx1ZS5zdWJzY3JpYmVJZCkpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYGdvdCBvYmplY3QgZm9yIHVua25vd24gc3Vic2NyaWJlSWQ6ICR7dmFsdWUuc3Vic2NyaWJlSWR9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBjb25zb2xlLmxvZyhcbiAgICAgICAgICAgIC8vICAgXCJ3cml0aW5nIHRvIHN1YnNjcmlwdGlvblwiLFxuICAgICAgICAgICAgLy8gICB0aGlzLnN1YnNjcmlwdGlvbnMuZ2V0KHZhbHVlLnN1YnNjcmliZUlkKVxuICAgICAgICAgICAgLy8gKTtcbiAgICAgICAgICAgIGNvbnN0IHdyaXRlciA9IHRoaXMuc3Vic2NyaXB0aW9uc1xuICAgICAgICAgICAgICAgIC5nZXQodmFsdWUuc3Vic2NyaWJlSWQpXG4gICAgICAgICAgICAgICAgLnN1YnNjcmlwdGlvbi53cml0YWJsZS5nZXRXcml0ZXIoKTtcbiAgICAgICAgICAgIGF3YWl0IHdyaXRlci53cml0ZSh2YWx1ZSk7XG4gICAgICAgICAgICB3cml0ZXIucmVsZWFzZUxvY2soKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBhc3luYyBoYW5kbGUobSkge1xuICAgICAgICBzd2l0Y2ggKG0udHlwZSkge1xuICAgICAgICAgICAgY2FzZSBtZXNzYWdlc18xLk1lc3NhZ2VUeXBlLlN1YnNjcmliZU9rOlxuICAgICAgICAgICAgICAgIHRoaXMuc3Vic2NyaXB0aW9ucy5nZXQobS5zdWJzY3JpYmVJZCk/LnN1YnNjcmliZU9rKCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgYXN5bmMgc3Vic2NyaWJlKG5hbWVzcGFjZSwgdHJhY2spIHtcbiAgICAgICAgY29uc3Qgc3ViSWQgPSB0aGlzLm5leHRTdWJzY3JpYmVJZCsrO1xuICAgICAgICBjb25zdCBzID0gbmV3IHN1YnNjcmlwdGlvbl8xLlN1YnNjcmlwdGlvbihzdWJJZCk7XG4gICAgICAgIHRoaXMuc3Vic2NyaXB0aW9ucy5zZXQoc3ViSWQsIHMpO1xuICAgICAgICBhd2FpdCB0aGlzLmNvbnRyb2xTdHJlYW0uc2VuZChuZXcgbWVzc2FnZXNfMS5TdWJzY3JpYmVFbmNvZGVyKHtcbiAgICAgICAgICAgIHR5cGU6IG1lc3NhZ2VzXzEuTWVzc2FnZVR5cGUuU3Vic2NyaWJlLFxuICAgICAgICAgICAgc3Vic2NyaWJlSWQ6IHN1YklkLFxuICAgICAgICAgICAgdHJhY2tBbGlhczogc3ViSWQsXG4gICAgICAgICAgICB0cmFja05hbWVzcGFjZTogbmFtZXNwYWNlLFxuICAgICAgICAgICAgdHJhY2tOYW1lOiB0cmFjayxcbiAgICAgICAgICAgIHN1YnNjcmliZXJQcmlvcml0eTogMCxcbiAgICAgICAgICAgIGdyb3VwT3JkZXI6IDEsXG4gICAgICAgICAgICBmaWx0ZXJUeXBlOiBtZXNzYWdlc18xLkZpbHRlclR5cGUuTGF0ZXN0R3JvdXAsXG4gICAgICAgICAgICBzdWJzY3JpYmVQYXJhbWV0ZXJzOiBbXSxcbiAgICAgICAgfSkpO1xuICAgICAgICBjb25zdCByZWFkYWJsZVN0cmVhbSA9IGF3YWl0IHMuZ2V0UmVhZGFibGVTdHJlYW0oKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN1YnNjcmliZUlkOiBzdWJJZCxcbiAgICAgICAgICAgIHJlYWRhYmxlU3RyZWFtLFxuICAgICAgICB9O1xuICAgIH1cbiAgICBhc3luYyB1bnN1YnNjcmliZShzdWJzY3JpYmVJZCkge1xuICAgICAgICB0aGlzLmNvbnRyb2xTdHJlYW0uc2VuZChuZXcgbWVzc2FnZXNfMS5VbnN1YnNjcmliZUVuY29kZXIoe1xuICAgICAgICAgICAgdHlwZTogbWVzc2FnZXNfMS5NZXNzYWdlVHlwZS5VbnN1YnNjcmliZSxcbiAgICAgICAgICAgIHN1YnNjcmliZUlkOiBzdWJzY3JpYmVJZCxcbiAgICAgICAgfSkpO1xuICAgIH1cbn1cbmV4cG9ydHMuU2Vzc2lvbiA9IFNlc3Npb247XG4iLCJcInVzZSBzdHJpY3RcIjtcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShleHBvcnRzLCBcIl9fZXNNb2R1bGVcIiwgeyB2YWx1ZTogdHJ1ZSB9KTtcbmV4cG9ydHMuU3Vic2NyaXB0aW9uID0gdm9pZCAwO1xuY2xhc3MgU3Vic2NyaXB0aW9uIHtcbiAgICBjb25zdHJ1Y3RvcihpZCkge1xuICAgICAgICB0aGlzLmlkID0gaWQ7XG4gICAgICAgIHRoaXMucHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgICAgIHRoaXMucmVzb2x2ZSA9IHJlc29sdmU7XG4gICAgICAgICAgICB0aGlzLnJlamVjdCA9IHJlamVjdDtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMuc3Vic2NyaXB0aW9uID0gbmV3IFRyYW5zZm9ybVN0cmVhbSh7XG4gICAgICAgICAgICB0cmFuc2Zvcm06IChjaHVuaywgY29udHJvbGxlcikgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXIuZW5xdWV1ZShjaHVuay5vYmplY3RQYXlsb2FkKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBzdWJzY3JpYmVPaygpIHtcbiAgICAgICAgdGhpcy5yZXNvbHZlKHRoaXMuc3Vic2NyaXB0aW9uLnJlYWRhYmxlKTtcbiAgICB9XG4gICAgc3Vic2NyaWJlRXJyb3IocmVhc29uKSB7XG4gICAgICAgIHRoaXMucmVqZWN0KHJlYXNvbik7XG4gICAgfVxuICAgIGdldFJlYWRhYmxlU3RyZWFtKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5wcm9taXNlO1xuICAgIH1cbn1cbmV4cG9ydHMuU3Vic2NyaXB0aW9uID0gU3Vic2NyaXB0aW9uO1xuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5PYmplY3QuZGVmaW5lUHJvcGVydHkoZXhwb3J0cywgXCJfX2VzTW9kdWxlXCIsIHsgdmFsdWU6IHRydWUgfSk7XG5leHBvcnRzLk1BWF9WQVJfSU5UXzggPSBleHBvcnRzLk1BWF9WQVJfSU5UXzQgPSBleHBvcnRzLk1BWF9WQVJfSU5UXzIgPSBleHBvcnRzLk1BWF9WQVJfSU5UXzEgPSB2b2lkIDA7XG5leHBvcnRzLmVuY29kZVZhcmludCA9IGVuY29kZVZhcmludDtcbmV4cG9ydHMuTUFYX1ZBUl9JTlRfMSA9IDYzO1xuZXhwb3J0cy5NQVhfVkFSX0lOVF8yID0gMTYzODM7XG5leHBvcnRzLk1BWF9WQVJfSU5UXzQgPSAxMDczNzQxODIzO1xuZXhwb3J0cy5NQVhfVkFSX0lOVF84ID0gNDYxMTY4NjAxODQyNzM4NzkwM247XG5mdW5jdGlvbiBlbmNvZGVWYXJpbnQoY2h1bmspIHtcbiAgICBpZiAoY2h1bmsgPD0gZXhwb3J0cy5NQVhfVkFSX0lOVF8xKSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBuZXcgVWludDhBcnJheSgxKTtcbiAgICAgICAgY29uc3QgdmlldyA9IG5ldyBEYXRhVmlldyhkYXRhLmJ1ZmZlcik7XG4gICAgICAgIHZpZXcuc2V0VWludDgoMCwgY2h1bmspO1xuICAgICAgICByZXR1cm4gZGF0YTtcbiAgICB9XG4gICAgZWxzZSBpZiAoY2h1bmsgPD0gZXhwb3J0cy5NQVhfVkFSX0lOVF8yKSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBuZXcgVWludDhBcnJheSgyKTtcbiAgICAgICAgY29uc3QgdmlldyA9IG5ldyBEYXRhVmlldyhkYXRhLmJ1ZmZlcik7XG4gICAgICAgIHZpZXcuc2V0VWludDE2KDAsIGNodW5rIHwgMHg0MDAwKTtcbiAgICAgICAgcmV0dXJuIGRhdGE7XG4gICAgfVxuICAgIGVsc2UgaWYgKGNodW5rIDw9IGV4cG9ydHMuTUFYX1ZBUl9JTlRfNCkge1xuICAgICAgICBjb25zdCBkYXRhID0gbmV3IFVpbnQ4QXJyYXkoNCk7XG4gICAgICAgIGNvbnN0IHZpZXcgPSBuZXcgRGF0YVZpZXcoZGF0YS5idWZmZXIpO1xuICAgICAgICB2aWV3LnNldFVpbnQzMigwLCBjaHVuayB8IDB4ODAwMDAwMDApO1xuICAgICAgICByZXR1cm4gZGF0YTtcbiAgICB9XG4gICAgZWxzZSBpZiAoY2h1bmsgPD0gZXhwb3J0cy5NQVhfVkFSX0lOVF84KSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBuZXcgVWludDhBcnJheSg4KTtcbiAgICAgICAgY29uc3QgdmlldyA9IG5ldyBEYXRhVmlldyhkYXRhLmJ1ZmZlcik7XG4gICAgICAgIHZpZXcuc2V0QmlnVWludDY0KDAsIEJpZ0ludChjaHVuaykgfCAweGMwMDAwMDAwMDAwMDAwMDBuLCBmYWxzZSk7XG4gICAgICAgIHJldHVybiBkYXRhO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJ2YWx1ZSB0b28gbGFyZ2UgZm9yIHZhcmludCBlbmNvZGluZ1wiKTtcbn1cbiIsIi8vIFRoZSBtb2R1bGUgY2FjaGVcbnZhciBfX3dlYnBhY2tfbW9kdWxlX2NhY2hlX18gPSB7fTtcblxuLy8gVGhlIHJlcXVpcmUgZnVuY3Rpb25cbmZ1bmN0aW9uIF9fd2VicGFja19yZXF1aXJlX18obW9kdWxlSWQpIHtcblx0Ly8gQ2hlY2sgaWYgbW9kdWxlIGlzIGluIGNhY2hlXG5cdHZhciBjYWNoZWRNb2R1bGUgPSBfX3dlYnBhY2tfbW9kdWxlX2NhY2hlX19bbW9kdWxlSWRdO1xuXHRpZiAoY2FjaGVkTW9kdWxlICE9PSB1bmRlZmluZWQpIHtcblx0XHRyZXR1cm4gY2FjaGVkTW9kdWxlLmV4cG9ydHM7XG5cdH1cblx0Ly8gQ3JlYXRlIGEgbmV3IG1vZHVsZSAoYW5kIHB1dCBpdCBpbnRvIHRoZSBjYWNoZSlcblx0dmFyIG1vZHVsZSA9IF9fd2VicGFja19tb2R1bGVfY2FjaGVfX1ttb2R1bGVJZF0gPSB7XG5cdFx0Ly8gbm8gbW9kdWxlLmlkIG5lZWRlZFxuXHRcdC8vIG5vIG1vZHVsZS5sb2FkZWQgbmVlZGVkXG5cdFx0ZXhwb3J0czoge31cblx0fTtcblxuXHQvLyBFeGVjdXRlIHRoZSBtb2R1bGUgZnVuY3Rpb25cblx0X193ZWJwYWNrX21vZHVsZXNfX1ttb2R1bGVJZF0obW9kdWxlLCBtb2R1bGUuZXhwb3J0cywgX193ZWJwYWNrX3JlcXVpcmVfXyk7XG5cblx0Ly8gUmV0dXJuIHRoZSBleHBvcnRzIG9mIHRoZSBtb2R1bGVcblx0cmV0dXJuIG1vZHVsZS5leHBvcnRzO1xufVxuXG4iLCJcInVzZSBzdHJpY3RcIjtcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShleHBvcnRzLCBcIl9fZXNNb2R1bGVcIiwgeyB2YWx1ZTogdHJ1ZSB9KTtcbmNvbnN0IHNyY18xID0gcmVxdWlyZShcIkBtZW5nZWxiYXJ0L21vcWpzL3NyY1wiKTtcbmFzeW5jIGZ1bmN0aW9uIG1haW4oKSB7XG4gICAgY29uc3QgdmlkZW9QbGF5ZXIgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndmlkZW9QbGF5ZXInKTtcbiAgICBjb25zdCBzZXJ2ZXJVcmwgPSAnaHR0cHM6Ly9sb2NhbGhvc3Q6ODA4MC9tb3EnO1xuICAgIGFzeW5jIGZ1bmN0aW9uIHBhcnNlTTNVKHVybCkge1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKHVybCk7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXNwb25zZS50ZXh0KCk7XG4gICAgICAgIGNvbnN0IGxpbmVzID0gZGF0YS5zcGxpdCgnXFxuJyk7XG4gICAgICAgIGNvbnN0IGNoYW5uZWxzID0gW107XG4gICAgICAgIGxldCBjdXJyZW50TmFtZSA9ICcnO1xuICAgICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcbiAgICAgICAgICAgIGlmIChsaW5lLnN0YXJ0c1dpdGgoJyNFWFRJTkY6JykpIHtcbiAgICAgICAgICAgICAgICBjdXJyZW50TmFtZSA9IGxpbmUuc3BsaXQoJywnKVsxXS50cmltKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmIChsaW5lLnN0YXJ0c1dpdGgoJ2h0dHAnKSB8fCBsaW5lLnN0YXJ0c1dpdGgoJ2h0dHBzJykpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBmaW5hbFVybCA9IGF3YWl0IHJlc29sdmVGaW5hbFVybChsaW5lLnRyaW0oKSk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChmaW5hbFVybCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY2hhbm5lbHMucHVzaCh7IG5hbWU6IGN1cnJlbnROYW1lLCB1cmw6IGZpbmFsVXJsIH0pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBGYWlsZWQgdG8gcmVzb2x2ZSBVUkwgZm9yIGNoYW5uZWwgJHtjdXJyZW50TmFtZX06YCwgZXJyb3IpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gY2hhbm5lbHM7XG4gICAgfVxuICAgIGFzeW5jIGZ1bmN0aW9uIHJlc29sdmVGaW5hbFVybCh1cmwpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsKTtcbiAgICAgICAgICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBmZXRjaCAke3VybH1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXNwb25zZS50ZXh0KCk7XG4gICAgICAgICAgICBpZiAoZGF0YS5pbmNsdWRlcygnI0VYVC1YLVNUUkVBTS1JTkYnKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGxpbmVzID0gZGF0YS5zcGxpdCgnXFxuJyk7XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGxpbmVzKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChsaW5lICYmICFsaW5lLnN0YXJ0c1dpdGgoJyMnKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzb2x2ZWRVcmwgPSBuZXcgVVJMKGxpbmUudHJpbSgpLCB1cmwpLnRvU3RyaW5nKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmVzb2x2ZWRVcmw7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdXJsO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcihcIkZhaWxlZCB0byBmZXRjaCBvciBwYXJzZSBVUkw6XCIsIGVycm9yKTtcbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgfVxuICAgIGFzeW5jIGZ1bmN0aW9uIGxvYWRQbGF5bGlzdCh1cmwpIHtcbiAgICAgICAgY29uc3QgbG9hZGluZ0luZGljYXRvciA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2FkaW5nSW5kaWNhdG9yJyk7XG4gICAgICAgIGNvbnN0IGxvYWRQbGF5bGlzdEJ1dHRvbiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2FkUGxheWxpc3QnKTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGxvYWRpbmdJbmRpY2F0b3Iuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XG4gICAgICAgICAgICBsb2FkUGxheWxpc3RCdXR0b24uZGlzYWJsZWQgPSB0cnVlO1xuICAgICAgICAgICAgY29uc3QgY2hhbm5lbHMgPSBhd2FpdCBwYXJzZU0zVSh1cmwpO1xuICAgICAgICAgICAgY29uc3QgY2hhbm5lbExpc3QgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY2hhbm5lbExpc3QnKTtcbiAgICAgICAgICAgIGNoYW5uZWxMaXN0LmlubmVySFRNTCA9ICcnO1xuICAgICAgICAgICAgY2hhbm5lbHMuZm9yRWFjaChjaGFubmVsID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBsaSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2xpJyk7XG4gICAgICAgICAgICAgICAgbGkudGV4dENvbnRlbnQgPSBjaGFubmVsLm5hbWU7XG4gICAgICAgICAgICAgICAgbGkuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiBzdWJzY3JpYmVUb0NoYW5uZWwoY2hhbm5lbC51cmwpKTtcbiAgICAgICAgICAgICAgICBjaGFubmVsTGlzdC5hcHBlbmRDaGlsZChsaSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXCJGYWlsZWQgdG8gbG9hZCBwbGF5bGlzdDpcIiwgZXJyb3IpO1xuICAgICAgICB9XG4gICAgICAgIGZpbmFsbHkge1xuICAgICAgICAgICAgbG9hZGluZ0luZGljYXRvci5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuICAgICAgICAgICAgbG9hZFBsYXlsaXN0QnV0dG9uLmRpc2FibGVkID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICB9XG4gICAgYXN5bmMgZnVuY3Rpb24gc3Vic2NyaWJlVG9DaGFubmVsKGNoYW5uZWxVcmwpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHNlc3Npb24gPSBhd2FpdCBzcmNfMS5TZXNzaW9uLmNvbm5lY3Qoc2VydmVyVXJsKTtcbiAgICAgICAgICAgIGNvbnN0IHZpZGVvVHJhY2tOYW1lc3BhY2UgPSBgaXB0di1tb3EvJHtlbmNvZGVVUklDb21wb25lbnQoY2hhbm5lbFVybCl9YDtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiU3Vic2NyaWJpbmcgdG8gbmFtZXNwYWNlOlwiLCB2aWRlb1RyYWNrTmFtZXNwYWNlKTtcbiAgICAgICAgICAgIGNvbnN0IHZpZGVvU3Vic2NyaXB0aW9uID0gYXdhaXQgc2Vzc2lvbi5zdWJzY3JpYmUodmlkZW9UcmFja05hbWVzcGFjZSwgJ3ZpZGVvJyk7XG4gICAgICAgICAgICBjb25zdCBhdWRpb1N1YnNjcmlwdGlvbiA9IGF3YWl0IHNlc3Npb24uc3Vic2NyaWJlKHZpZGVvVHJhY2tOYW1lc3BhY2UsICdhdWRpbycpO1xuICAgICAgICAgICAgY29uc3QgbWVkaWFTb3VyY2UgPSBuZXcgTWVkaWFTb3VyY2UoKTtcbiAgICAgICAgICAgIHZpZGVvUGxheWVyLnNyYyA9IFVSTC5jcmVhdGVPYmplY3RVUkwobWVkaWFTb3VyY2UpO1xuICAgICAgICAgICAgbWVkaWFTb3VyY2UuYWRkRXZlbnRMaXN0ZW5lcignc291cmNlb3BlbicsICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCB2aWRlb1NvdXJjZUJ1ZmZlciA9IG1lZGlhU291cmNlLmFkZFNvdXJjZUJ1ZmZlcigndmlkZW8vbXA0OyBjb2RlY3M9XCJhdmMxLjQyRTAxRSwgbXA0YS40MC4yXCInKTtcbiAgICAgICAgICAgICAgICBjb25zdCBhdWRpb1NvdXJjZUJ1ZmZlciA9IG1lZGlhU291cmNlLmFkZFNvdXJjZUJ1ZmZlcignYXVkaW8vbXA0OyBjb2RlY3M9XCJtcDRhLjQwLjJcIicpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHByb2Nlc3NWaWRlbyA9ICh7IGRvbmUsIHZhbHVlIH0pID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGRvbmUgfHwgIXZhbHVlKVxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICB2aWRlb1NvdXJjZUJ1ZmZlci5hcHBlbmRCdWZmZXIodmFsdWUub2JqZWN0UGF5bG9hZCk7XG4gICAgICAgICAgICAgICAgICAgIHZpZGVvU3Vic2NyaXB0aW9uLnJlYWRhYmxlU3RyZWFtLmdldFJlYWRlcigpLnJlYWQoKS50aGVuKHByb2Nlc3NWaWRlbyk7XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBjb25zdCBwcm9jZXNzQXVkaW8gPSAoeyBkb25lLCB2YWx1ZSB9KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChkb25lIHx8ICF2YWx1ZSlcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgYXVkaW9Tb3VyY2VCdWZmZXIuYXBwZW5kQnVmZmVyKHZhbHVlLm9iamVjdFBheWxvYWQpO1xuICAgICAgICAgICAgICAgICAgICBhdWRpb1N1YnNjcmlwdGlvbi5yZWFkYWJsZVN0cmVhbS5nZXRSZWFkZXIoKS5yZWFkKCkudGhlbihwcm9jZXNzQXVkaW8pO1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgdmlkZW9TdWJzY3JpcHRpb24ucmVhZGFibGVTdHJlYW0uZ2V0UmVhZGVyKCkucmVhZCgpLnRoZW4ocHJvY2Vzc1ZpZGVvKTtcbiAgICAgICAgICAgICAgICBhdWRpb1N1YnNjcmlwdGlvbi5yZWFkYWJsZVN0cmVhbS5nZXRSZWFkZXIoKS5yZWFkKCkudGhlbihwcm9jZXNzQXVkaW8pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKFwiRmFpbGVkIHRvIHNldCB1cCBNb1Egc2Vzc2lvbjpcIiwgZXJyb3IpO1xuICAgICAgICB9XG4gICAgfVxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2FkUGxheWxpc3QnKS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcbiAgICAgICAgY29uc3QgcGxheWxpc3RVcmwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncGxheWxpc3RVcmwnKS52YWx1ZTtcbiAgICAgICAgbG9hZFBsYXlsaXN0KHBsYXlsaXN0VXJsKTtcbiAgICB9KTtcbn1cbm1haW4oKTtcbiJdLCJuYW1lcyI6W10sInNvdXJjZVJvb3QiOiIifQ==