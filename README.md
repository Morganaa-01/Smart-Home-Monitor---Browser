# IoT Smart Greenhouse Web Monitoring

Browser interface for an ESP32-based greenhouse prototype. The server reads the latest measurements from the configured ThingSpeak channel, the dashboard shows the values and device states, and the AI chat receives the current data package.

## ThingSpeak fields

The channel ID and, if needed, the Read API Key are set as server-side environment variables. The key is never sent to the browser; it is required for requests to a private channel.

| Field | Channel setting |
| --- | --- |
| `field1` | Temperature (°C) |
| `field2` | Relative humidity (%) |
| `field3` | Air pressure (unit not specified by the firmware) |
| `field4` | Illuminance (lux) |
| `field5` | Rain (1/0) |
| `field6` | Fan (1/0) |
| `field7` | LED (1/0) |
| `field8` | Roof (1/0) |

The dashboard requests the latest 60 feeds from the server-side `/api/thingspeak` endpoint; it draws the measurement history from the same data, and the latest package is also passed to the AI chat.

## Login

The server checks the login credentials and issues a signed, HttpOnly session cookie. The ThingSpeak and AI endpoints cannot be used without logging in.

Set these environment variables both locally in the `.env` file and in Vercel:

- `ADMIN_USERNAME` – administrator username
- `ADMIN_PASSWORD` – administrator password
- `SESSION_SECRET` – a random secret at least 32 characters long

Do not put the login password or the session secret in the source code, and do not upload them to GitHub. On public hosting, use a unique, strong password.

## Running locally

```powershell
npm install
npm start
```

If PowerShell blocks `npm` because script execution is disabled, use `npm.cmd install` and `npm.cmd start` instead.

The local server reads the `OPENAI_API_KEY`, `THINGSPEAK_CHANNEL_ID`, `THINGSPEAK_READ_API_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` and `SESSION_SECRET` variables from the `.env` file in the project root. Do not commit the `.env` file to version control. When deploying to a host, set the same variables in the host's environment settings.

The AI chat is shown even without a server, but it can only answer once the API key is configured. Live ThingSpeak data requires an internet connection.

## Saving and emailing the measurement report

Next to the environment measurements, the **Mentés PDF-be** (Save to PDF) button immediately downloads a single-page A4 PDF file (`noveny-haz-jelentes-YYYY-MM-DD.pdf`). The PDF is generated in the browser, without external libraries or a server.

The **Küldés e-mailben** (Send by email) button prepares the same PDF for email:

- Where the browser supports file sharing (Chrome and Edge on Windows 10/11, Android, iOS), the system share sheet opens; choosing a mail app (Mail, Outlook, Gmail) there attaches the PDF automatically.
- In other browsers the PDF is downloaded and the default mail client opens with a prefilled subject. The downloaded file has to be attached by hand, because a `mailto:` link cannot carry attachments.

The report contains the eight most recently loaded measurements and device states, the measurement time and the time the report was created. Old or missing data is marked separately. It does not export the chat, login details or API keys. The buttons are disabled until the first measurement has loaded.
