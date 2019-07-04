import { mergeBuffer, readBuffer, createWorker } from '../../../utils';
import SuperRender from './SuperRender_20';
import workerString from './wsPlayer.worker';

export default class VideoDecoder {
    constructor(flv) {
        this.flv = flv;
        const { player, events, options } = flv;

        this.playing = false;
        this.playIndex = 0;
        this.videoframes = [];
        this.timestamps = [];
        this.videoInputLength = 0;
        this.decoding = false;
        this.byteSize = 0;
        this.loaded = 0;
        this.playTimer = null;
        this.decoderWorker = createWorker(workerString);
        this.renderer = new SuperRender(player.$canvas);

        flv.on('destroy', () => {
            this.videoframes = [];
            this.decoderWorker.terminate();
            this.stop();
        });

        events.proxy(this.decoderWorker, 'message', event => {
            const message = event.data;
            switch (message.command) {
                case 'video':
                    this.byteSize += message.YData.byteLength + message.UData.byteLength + message.VData.byteLength;
                    this.videoframes.push(message);
                    this.decoding = this.videoframes.length !== this.videoInputLength;
                    this.loaded = this.videoframes.length / player.frameRate;
                    flv.emit('videoLoaded', this.loaded);
                    if (this.videoframes.length === 1 && !options.poster) {
                        this.draw(0);
                    }
                    break;
                default:
                    break;
            }
        });

        let sps = new Uint8Array();
        let pps = new Uint8Array();
        flv.on('videoData', (uint8, timestamp) => {
            const readNalu = readBuffer(uint8);
            readNalu(4);
            const nalHeader = readNalu(1)[0];
            const naluType = nalHeader & 31;
            switch (naluType) {
                case 1:
                case 5: {
                    this.decoding = true;
                    const frame = mergeBuffer(sps, pps, uint8);
                    this.decoderWorker.postMessage(frame.buffer, [frame.buffer]);
                    this.timestamps.push(timestamp);
                    this.videoInputLength += 1;
                    break;
                }
                case 7:
                    sps = uint8;
                    break;
                case 8:
                    pps = uint8;
                    break;
                default:
                    break;
            }
        });

        flv.on('timeupdate', currentTime => {
            const timestamp = this.timestamps[this.playIndex];
            if (timestamp && currentTime * 1000 >= timestamp) {
                const state = this.draw(this.playIndex);
                if (state) {
                    this.playIndex += 1;
                } else {
                    this.stop();
                }
            }
        });
    }

    draw(index) {
        const videoframe = this.videoframes[index];
        if (!videoframe) return false;
        this.renderer.SR_DisplayFrameData(
            videoframe.width,
            videoframe.height,
            new Uint8Array(videoframe.YData),
            new Uint8Array(videoframe.UData),
            new Uint8Array(videoframe.VData),
        );
        if (this.flv.options.live) {
            this.videoframes[index] = null;
        }
        return true;
    }

    play(startTime = 0) {
        this.playing = true;
        this.playIndex = Math.round(startTime * this.flv.player.frameRate);
    }

    stop() {
        this.playing = false;
    }
}