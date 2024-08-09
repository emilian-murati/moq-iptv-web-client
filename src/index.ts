import { Session } from "@mengelbart/moqjs/src";

async function main() {
    const videoPlayer = document.getElementById('videoPlayer') as HTMLVideoElement;

    const serverUrl = 'https://localhost:8080/moq';

    async function parseM3U(url: string): Promise<{ name: string, url: string }[]> {
        const response = await fetch(url);
        const data = await response.text();
        const lines = data.split('\n');
        const channels = [];
        let currentName = '';

        for (const line of lines) {
            if (line.startsWith('#EXTINF:')) {
                currentName = line.split(',')[1].trim();
            } else if (line.startsWith('http') || line.startsWith('https')) {
                try {
                    const finalUrl = await resolveFinalUrl(line.trim());
                    if (finalUrl) {
                        channels.push({ name: currentName, url: finalUrl });
                    }
                } catch (error) {
                    console.error(`Failed to resolve URL for channel ${currentName}:`, error);
                }
            }
        }
        return channels;
    }

    async function resolveFinalUrl(url: string): Promise<string | null> {
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
        } catch (error) {
            console.error("Failed to fetch or parse URL:", error);
            return null;
        }
    }

    async function loadPlaylist(url: string) {
        const loadingIndicator = document.getElementById('loadingIndicator')!;
        const loadPlaylistButton = document.getElementById('loadPlaylist')! as HTMLButtonElement;

        try {
            loadingIndicator.style.display = 'block';
            loadPlaylistButton.disabled = true;

            const channels = await parseM3U(url);
            const channelList = document.getElementById('channelList')!;
            channelList.innerHTML = '';

            channels.forEach(channel => {
                const li = document.createElement('li');
                li.textContent = channel.name;
                li.addEventListener('click', () => subscribeToChannel(channel.url));
                channelList.appendChild(li);
            });
        } catch (error) {
            console.error("Failed to load playlist:", error);
        } finally {
            loadingIndicator.style.display = 'none';
            loadPlaylistButton.disabled = false;
        }
    }

    async function subscribeToChannel(channelUrl: string) {
        try {
            const session = await Session.connect(serverUrl);

            const videoTrackNamespace = `iptv-moq/${encodeURIComponent(channelUrl)}`;
            console.log("Subscribing to namespace:", videoTrackNamespace);

            const videoSubscription = await session.subscribe(videoTrackNamespace, 'video');
            const audioSubscription = await session.subscribe(videoTrackNamespace, 'audio');

            const mediaSource = new MediaSource();
            videoPlayer.src = URL.createObjectURL(mediaSource);

            mediaSource.addEventListener('sourceopen', () => {
                const videoSourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
                const audioSourceBuffer = mediaSource.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');

                const processVideo = ({ done, value }: ReadableStreamReadResult<any>) => {
                    if (done || !value) return;
                    videoSourceBuffer.appendBuffer(value.objectPayload);
                    videoSubscription.readableStream.getReader().read().then(processVideo);
                };

                const processAudio = ({ done, value }: ReadableStreamReadResult<any>) => {
                    if (done || !value) return;
                    audioSourceBuffer.appendBuffer(value.objectPayload);
                    audioSubscription.readableStream.getReader().read().then(processAudio);
                };

                videoSubscription.readableStream.getReader().read().then(processVideo);
                audioSubscription.readableStream.getReader().read().then(processAudio);
            });
        } catch (error) {
            console.error("Failed to set up MoQ session:", error);
        }
    }

    document.getElementById('loadPlaylist')!.addEventListener('click', () => {
        const playlistUrl = (document.getElementById('playlistUrl') as HTMLInputElement).value;
        loadPlaylist(playlistUrl);
    });
}

main();
