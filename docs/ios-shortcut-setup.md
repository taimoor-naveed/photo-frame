# iOS Shortcut: Upload to Photo Frame

Upload photos, videos, and Live Photos from your iPhone to the photo frame via the Share Sheet. Live Photos are automatically encoded as video before upload.

## Prerequisites

- iPhone on the same network as the photo frame server
- Server URL (e.g., `http://home-pc/api/media` for prod, `http://YOUR_IP:8000/api/media` for dev)

## Create the Shortcut

Open the **Shortcuts** app and create a new shortcut with these actions:

### 1. Receive Input from Share Sheet

- **Receive** → Images and Media → from **Share Sheet**
- If there's no input: **Stop and Respond** → "No media selected"

### 2. Set Upload URL

- Add a **Text** action with your server's upload endpoint:
  `http://YOUR_IP:8000/api/media`

### 3. Loop Through Each Item

- Add **Repeat with each item** in **Shortcut Input**

Inside the loop:

1. **Set variable** `UploadItem` to **Repeat Item**
2. **Get Media Type** from `UploadItem`
3. **If** Media Type **is Image**:
   - **Get Photo Type** from `UploadItem`
   - **If** Photo Type **is Live Photo**:
     - **Encode** `UploadItem` (this extracts the video from the Live Photo)
     - **Set variable** `UploadItem` to **Encoded Media**
   - **End If**
4. **End If**
5. **Show** `UploadItem` **in Quick Look** (optional — lets you preview before upload)
6. **Get Contents of** the Text URL (this POSTs the file to the server)

### 4. Name and Configure

1. Rename the shortcut to **Upload to Photo Frame**
2. Enable **Show in Share Sheet** and set share types to **Images** and **Media**
3. Optionally **Add to Home Screen** for quick access

## Usage

1. In the Photos app, select photos/videos
2. Tap **Share** → **Upload to Photo Frame**
3. Each item is previewed (Quick Look) then uploaded

## How It Works

- **Regular photos/videos**: Uploaded directly
- **Live Photos**: Detected via Photo Type check, encoded to extract the video component, then uploaded. The backend processes it like any video.
- **Android Motion Photos**: Handled server-side — the backend detects embedded video in the JPEG automatically.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Could not connect to the server" | Check you're on the same Wi-Fi. Verify the URL in Safari. |
| Live Photo uploaded as image | Make sure the Encode action is inside the Live Photo "If" block. |
| Nothing appears after upload | Check the URL has no trailing slash after `/api/media`. |
