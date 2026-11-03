# Demonstrating Matelda for Multi-Table Error Detection

[![Read Paper](https://img.shields.io/badge/📄%20Read%20Paper-OpenProceedings-blue)](https://www.openproceedings.org/2025/conf/edbt/paper-98.pdf)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![Streamlit](https://img.shields.io/badge/streamlit-1.0+-red.svg)](https://streamlit.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Real-world datasets are often fragmented across multiple heterogeneous tables, managed by different teams or organizations. Ensuring data quality in such environments is challenging, as traditional error detection tools typically operate on isolated tables and overlook cross-table relationships. To address this gap, we investigate how cleaning multiple tables simultaneously, combined with structured user collaboration, can reduce annotation effort and enhance the effectiveness and efficiency of error detection.

We present Matelda, an interactive system for multi-table error detection that combines automated error detection with human-in-the-loop refinement. Matelda guides users through Inspection \& Action, allowing them to explore system-generated insights, refine decisions, and annotate data with contextual support. It organizes tables using domain-based and quality-based folding and leverages semi-supervised learning to propagate labels across related tables efficiently. Our demonstration showcases Matelda’s capabilities for collaborative error detection and resolution by leveraging shared knowledge, contextual similarity, and structured user interactions across multiple tables.

## Screenshots 

![Pipeline](screenshots/pipeline-git.png)
![Labeling](screenshots/labeling-git.png)

## Video

Link to the Video: [Matelda Demo](videos/Matelda-Demo.mp4)

## 📦 Installation

```bash
git clone https://github.com/D2IP-TUB/Matelda-Demo.git
cd Matelda-Demo
```

## 🚀 Quick Start

### Prerequisites

Ensure you have Python 3.10+ installed on your system.

### Setup

1. **Create a virtual environment** (recommended)
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Linux/macOS
   venv\Scripts\activate     # On Windows
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Download NLTK data** (required for the backend)
   ```bash
   python -c "import nltk; nltk.download('stopwords'); nltk.download('punkt'); nltk.download('punkt_tab')"
   ```

4. **Run the application**
   ```bash
   streamlit run app.py
   ```

5. **Open your browser** to `http://localhost:8501` (or `https://...` if you run with HTTPS; see below).

### Running with HTTPS

You can serve the app over HTTPS in two ways:

**Option A: Reverse proxy (recommended for production)**  
Run Streamlit as usual on HTTP and put a reverse proxy (e.g. nginx, Caddy, Traefik) in front that terminates TLS. Point the proxy at `http://127.0.0.1:8501` and set `X-Forwarded-Proto: https` (and optionally `X-Forwarded-For`) so Streamlit sees the correct scheme.

**Option B: Direct SSL**  
Provide PEM certificate and key when starting Streamlit:

```bash
streamlit run app.py \
  --server.sslCertFile=/path/to/fullchain.pem \
  --server.sslKeyFile=/path/to/privkey.pem
```

Or in `.streamlit/config.toml` under `[server]` set `sslCertFile` and `sslKeyFile` to the paths of your certificate and private key, then run `streamlit run app.py`. The app will listen on HTTPS (e.g. `https://localhost:8501`).

## 🛠️ Architecture

### Core Components

- **Backend**: Core data processing and ML algorithms (`backend/`)
- **Components**: Reusable UI components (`components/`)
- **Pages**: Application pages and workflows (`pages/`)
- **Pipelines**: Pre-configured processing pipelines (`pipelines/`)

## 🧪 Development

### Local Development

```bash
# Clone the repository
git clone https://github.com/D2IP-TUB/Matelda-Demo.git
cd Matelda-Demo

# Install development dependencies
pip install -r requirements.txt

# Download NLTK data (if not already done)
python -c "import nltk; nltk.download('stopwords'); nltk.download('punkt'); nltk.download('punkt_tab')"

# Run in development mode
streamlit run app.py --server.runOnSave true
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

## 📞 Support

- 🐛 **Issues**: [GitHub Issues](https://github.com/D2IP-TUB/Matelda-Demo/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/D2IP-TUB/Matelda-Demo/discussions)

Thank you for choosing *Matelda for efficient data lake cleaning. We believe that this approach will significantly improve the quality of your data while saving you time and resources. Happy data cleaning!

## Multiplayer rooms

Several people can label together: each creates or joins a room (link, room name or QR code), votes for a dataset in the lobby, and labels their own cells. Labels are pooled per room; each player then continues with their own configuration.

1. Download PocketBase (v0.23+) into `pocketbase/` and verify its checksum from the official release page, then create an admin: `pocketbase/pocketbase superuser upsert <email> <password>`.
2. Put `MATELDA_BASE_URL=http://<LAN_IP>:8501` in a `.env` file, then run `scripts/run_multiplayer.sh`. It starts PocketBase, creates the collections and starts the app.
3. Players open `http://<LAN_IP>:8501/Lobby`. The live leaderboard for the projector is `http://<LAN_IP>:8090/`.

The PocketBase collections have public API rules (demo setup); only run this on a trusted network.

## React + FastAPI + PocketBase (development)

The app is being moved from Streamlit to three separate services. The Streamlit app keeps working until every page is ported.

| Part | Folder | Port | Role |
|---|---|---|---|
| React frontend | `frontend/` | 5173 | All UI. Talks to PocketBase directly (rooms, votes, sessions, realtime) and to the API for ML work. |
| FastAPI | `api/` | 8000 (loopback only) | The only code that imports `backend/` (and through it `Matelda/`). Endpoints live under `/api`; long steps run as background jobs polled via `GET /api/jobs/{id}`. |
| PocketBase | `pocketbase/` | 8090 | Rooms, players, labels, runs and per-browser `sessions`. Schema is created by `scripts/init_pocketbase.py`. |

**Run everything:** `scripts/dev.sh`. It starts PocketBase, creates the collections, then starts the API and the Vite dev server. Vite proxies `/api` to FastAPI, so the browser only needs ports 5173 and 8090. It reads the host from `MATELDA_BASE_URL` in `.env` (the port in that variable is ignored; the Streamlit launcher still uses it). Open `http://<host>:5173/lobby`; `/dev` runs a real domain-folding job.

**One-time setup:** `uv pip install --python venv/bin/python -r api/requirements.txt` and `cd frontend && npm install`.

**Tests:** `venv/bin/python -m pytest api/tests` (add `-m slow` for the real pipeline run) and `cd frontend && npm test`. After changing API models, regenerate the typed client with the API running: `cd frontend && npm run gen:api`.
