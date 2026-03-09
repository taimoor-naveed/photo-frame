# iOS Shortcut: Upload to Photo Frame

Upload photos, videos, and Live Photos from your iPhone to the photo frame. Live Photos automatically have their video extracted and uploaded.

## Prerequisites

- iPhone on the same network as the photo frame server
- Server URL (e.g., `http://home-pc` for prod, `http://192.168.1.x:8000` for dev)

## Create the Shortcut

Open the **Shortcuts** app on your iPhone and create a new shortcut.

### Step 1: Configure Server URL

1. Add action: **Text**
2. Set the text to your server URL (no trailing slash):
   - Prod: `http://home-pc`
   - Dev: `http://YOUR_MAC_IP:8000`
3. Tap the text action title and rename it to **Server URL**

### Step 2: Select Photos

1. Add action: **Select Photos**
2. Enable **Select Multiple**

### Step 3: Count Selected Photos

1. Add action: **Count**
2. Set input to **Selected Photos**
3. Add action: **Set Variable** → name it **Total Count**

### Step 4: Set Up Counter

1. Add action: **Number** → set to `0`
2. Add action: **Set Variable** → name it **Success Count**

### Step 5: Loop Through Each Photo

1. Add action: **Repeat with Each** (input: **Selected Photos**)

Inside the loop, add these actions in order:

#### 5a: Check if Live Photo

1. Add action: **If**
2. Set condition: **Repeat Item** → **Media Type** → **is** → **Live Photo**

#### 5b: Live Photo Branch (inside "If")

1. Add action: **Encode Media**
   - Input: **Repeat Item**
   - Tap **Show More**
   - Toggle OFF **Audio Only**
   - This extracts the video component from the Live Photo

#### 5c: Otherwise Branch

1. In the **Otherwise** section — no action needed, the **Repeat Item** passes through as-is

#### 5d: Upload the File (after End If)

1. Add action: **Get Contents of URL**
2. URL: tap **Server URL** variable, then type `/api/media` after it
   - Result: `Server URL/api/media`
3. Method: **POST**
4. Request Body: **Form**
5. Add new field:
   - Type: **File**
   - Key: `files`
   - Value: **If Result** (this is the output of the If/Otherwise block)

#### 5e: Handle Response

1. Add action: **If**
2. Condition: **Get Contents of URL** → **has any value**
3. Inside If:
   - Add action: **Calculate** → **Success Count** + 1
   - Add action: **Set Variable** → **Success Count**
4. **End If**

### Step 6: End Repeat

The **End Repeat** closes the loop automatically.

### Step 7: Show Result

1. Add action: **Show Notification**
2. Title: `Photo Frame`
3. Body: Tap **Success Count**, type ` of `, tap **Total Count**, type ` uploaded`

### Step 8: Name and Configure

1. Tap the shortcut name at the top → rename to **Upload to Photo Frame**
2. Tap the **(i)** or settings icon:
   - Enable **Show in Share Sheet**
   - Under "Share Sheet Types", select: **Images**, **Videos**, **Media**
3. Tap **Add to Home Screen** for quick access

## Using the Shortcut

### From Home Screen
1. Tap the shortcut icon
2. Select photos/videos from the picker
3. Wait for upload notification

### From Share Sheet
1. In the Photos app, select one or more photos
2. Tap **Share** → **Upload to Photo Frame**
3. Wait for upload notification

## Switching Between Dev and Prod

Edit the shortcut and change the **Text** action in Step 1:
- **Prod:** `http://home-pc`
- **Dev:** `http://YOUR_MAC_IP:8000` (find your Mac's IP via System Settings → Wi-Fi → Details)

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Could not connect to the server" | Check you're on the same Wi-Fi network. Verify the URL. |
| Upload seems to work but nothing appears | Check the server URL has no trailing slash. Check the field name is exactly `files`. |
| Live Photo uploaded as image, not video | Make sure the **Encode Media** action is inside the "If" (Live Photo) branch. |
| Shortcut is slow with many files | Normal — files upload one at a time. Large videos take longer. |
| "0 of X uploaded" | Server may be down. Try the URL in Safari first: `http://home-pc/api/media` should return 405 Method Not Allowed (meaning it's reachable). |

## How It Works

- **Regular photos/videos**: Uploaded as-is to `POST /api/media`
- **Live Photos**: The Encode Media action extracts the video component (MOV). The backend processes it like any other video upload.
- **Android Motion Photos**: Not relevant here — those are handled server-side when uploaded via the web browser (the backend detects the embedded video in the JPEG).
