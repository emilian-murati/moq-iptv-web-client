# IPTV Playlist Player

This project is a web-based IPTV Playlist Player that allows users to load an M3U playlist from a URL, parse the playlist to extract channel names and URLs, and then play selected channels using Media over QUIC (MoQ). The client connects to a MoQ server using WebTransport.


## Installation

Follow the steps below to get the project up and running:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/emilian-murati/moq-iptv-web-client.git
   ```

2. **Navigate to the project directory:**
   ```bash
   cd moq-iptv-web-client
   ```

3. **Install the required dependencies:**
   ```bash
   npm install
   ```

4. **Bundle the project using Webpack:**
   ```bash
   npx webpack
   ```

5. **Start the development server:**
   ```bash
   npx webpack serve
   ```

6. **Ensure your MoQ server is running:**

   Make sure that your MoQ server is up and running on `https://localhost:8080/moq`. If your server uses a different address or configuration, you can modify the server URL, namespace, and other related settings in the code to match your server's configuration. This can be done in the `index.ts` file, specifically at the following sections:

   - **Server URL:** Update the `serverUrl` variable.
   - **Namespace:** Adjust the `videoTrackNamespace` variable to match your server's namespace.

## Configuration

Ensure that both your MoQ server and client are using the same version of the MoQ protocol. You can adjust this setting in the `messages.ts` file located in the `@mengelbart/moqjs/src/` directory.

```typescript
export const CURRENT_SUPPORTED_DRAFT = DRAFT_IETF_MOQ_TRANSPORT_03;
```

## Usage

1. **Load the Web Application:**

   Once the development server is running, open your browser and navigate to `http://localhost:9000`.

2. **Enter the Playlist URL:**

   In the input field labeled "Enter IPTV Playlist URL," input the URL of your M3U playlist and click "Load Playlist."
   Sample iptv playlist (https://iptv-org.github.io/iptv/categories/outdoor.m3u)

3. **Select a Channel:**

   The application will display a list of channels parsed from the playlist. Click on a channel name to subscribe to it.

4. **Video Playback:**

   The video player at the bottom serves only as a placeholder. While channel selection is currently functional, actual video playback is not yet implemented and will be added in a future update.

## Acknowledgements

This project utilizes the [moqjs](https://github.com/mengelbart/moqjs) repository for Media over QUIC implementation.

---