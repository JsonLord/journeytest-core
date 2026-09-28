FROM node:24-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip git wget ca-certificates && rm -rf /var/lib/apt/lists/*
RUN wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -O /tmp/chrome.deb && (dpkg -i /tmp/chrome.deb || (apt-get update && apt-get install -fy)) && rm /tmp/chrome.deb
WORKDIR /app
COPY package*.json ./
RUN npm ci && npm install -g agent-browser@0.31.1
COPY python/requirements-space.txt /tmp/requirements-space.txt
RUN pip3 install --break-system-packages --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu torch && pip3 install --break-system-packages --no-cache-dir -r /tmp/requirements-space.txt && git clone https://github.com/JsonLord/laya-browser-agent.git /tmp/laya-browser-agent && cd /tmp/laya-browser-agent && git checkout c71b7c7b3319d0b8e5a93eec150af2e6ba5cfc35 && pip3 install --break-system-packages --no-cache-dir '.[torch]' && rm -rf /tmp/laya-browser-agent /tmp/requirements-space.txt
COPY . .
RUN npm run build
ENV LAYA_MODE=auto LAYA_BACKEND=torch LAYA_MODEL_REPO=ichenney/laya-browser-v32b LAYA_MODEL_REVISION=161d54d6000913ff279b0afd1ac77faef8685a9b MAX_CONCURRENT_JOURNEYS=1 JOURNEYTEST_PYTHON=python3 AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7860/api/v1/health', timeout=4)"
CMD ["node", "dist/cli.js", "space", "--host", "0.0.0.0", "--port", "7860"]
