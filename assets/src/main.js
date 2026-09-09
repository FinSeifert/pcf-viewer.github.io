import { PcfParser } from "./parser.js";
import { SceneBuilder } from "./scene-builder.js";

// Initialize the 3D scene builder & UI
const builder = new SceneBuilder();

// Handle PCF generation events
window.addEventListener('pcf-url', async (e) => {
    builder.ui.showSpinner();
    try {
        let url, fileName;
        if (typeof e.detail === 'object') {
            url = e.detail.url;
            fileName = e.detail.name;
        } else {
            url = e.detail;
            fileName = `Model ${builder.filesData.length + 1}`;
        }
        if (!url) return;

        const isLoopback = /^http:\/\/127\.0\.0\.1:\d+\//.test(url);
        const request = isLoopback
            ? new Request(url, {
                mode: 'cors',
                cache: 'no-store',
                targetAddressSpace: 'loopback'
            })
            : new Request(url);
        const response = await fetch(request);
        if (!response.ok) {
            throw new Error(`PCF could not be loaded (${response.status}).`);
        }

        const buffer = await response.arrayBuffer();
        const text = new TextDecoder('utf-8').decode(buffer);
        const parsed = new PcfParser(text).parse();

        builder.addFile(parsed, fileName);

        // Reset file input so same file can be re-selected
        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.value = '';
    }
    catch (err) {
        console.error('Error loading PCF:', err);
        const card = document.querySelector('.drop-card');
        if (card) card.classList.remove('hidden');

        const infoBox = document.getElementById('infoBox');
        if (infoBox) {
            infoBox.textContent = 'The PCF could not be loaded. Allow local network access for this site and try again.';
            infoBox.style.left = '16px';
            infoBox.style.top = '16px';
            infoBox.style.display = 'block';
        }
    }
    finally {
        builder.ui.hideSpinner();
    }
});

// Set up UI interactions once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // DOM references
    const card = document.querySelector('.drop-card');
    const fileInput = document.getElementById('file-input');
    const selectBtn = document.getElementById('select-file');
    const sampleBtn   = document.getElementById('load-sample');
    const sideMenu = document.getElementById('sideMenu');
    const spinnerText = document.getElementById('spinner-text');

    // Handle a single file: update UI and dispatch PCF event
    function handleFile(file) {
        sideMenu.innerHTML = '';
        card.classList.add('hidden');

        spinnerText.textContent = `Generate ${file.name}…`;
        builder.ui.showSpinner();

        const blobUrl = URL.createObjectURL(file);
        window.dispatchEvent(new CustomEvent('pcf-url', {
            detail: {
                url: blobUrl,
                name: file.name
            }
        }));
    }

    // R2P passes a short-lived, token-protected loopback URL to the online viewer.
    function loadPcfFromQuery() {
        const params = new URLSearchParams(window.location.search);
        const sourceUrl = params.get('pcf');
        if (!sourceUrl) return;

        let source;
        try {
            source = new URL(sourceUrl);
        }
        catch {
            console.warn('Ignored invalid PCF source URL.');
            return;
        }

        const validSource = source.protocol === 'http:'
            && source.hostname === '127.0.0.1'
            && /^\d+$/.test(source.port)
            && /^\/[0-9a-f]{32}$/i.test(source.pathname);
        if (!validSource) {
            console.warn('Ignored PCF source outside the R2P loopback bridge.');
            return;
        }

        const fileName = (params.get('name') || 'R2P export.pcf')
            .replace(/[<>&\"'`]/g, '_')
            .slice(0, 260);
        sideMenu.innerHTML = '';
        card.classList.add('hidden');
        spinnerText.textContent = `Generate ${fileName}…`;

        // Do not retain the short-lived source token in the browser history.
        history.replaceState(null, '', `${location.pathname}${location.hash}`);
        window.dispatchEvent(new CustomEvent('pcf-url', {
            detail: {
                url: source.href,
                name: fileName
            }
        }));
    }

    loadPcfFromQuery();

    // Load the sample PCF from repo path
    sampleBtn.addEventListener('click', () => {
        card.classList.add('hidden');
        spinnerText.textContent = `Generate sample.pcf…`;
        builder.ui.showSpinner();
        window.dispatchEvent(new CustomEvent('pcf-url', {
            detail: {
                url: 'sample_pcf/sample.pcf',
                name: 'sample.pcf'
            }
        }));
    });

    // Drag & Drop: prevent default and toggle hover class
    ['dragenter', 'dragover'].forEach(evt =>
        document.body.addEventListener(evt, e => {
            e.preventDefault();
            document.body.classList.add('drag-hover');
        })
    );
    ['dragleave', 'drop'].forEach(evt =>
        document.body.addEventListener(evt, e => {
            e.preventDefault();
            document.body.classList.remove('drag-hover');
        })
    );

    // On drop, filter for .pcf files
    document.body.addEventListener('drop', e => {
        e.preventDefault();
        Array.from(e.dataTransfer.files)
            .filter(f => /\.pcf$/i.test(f.name))
            .forEach(f => handleFile(f));
    });

    // Button to open file dialog
    selectBtn.addEventListener('click', () => fileInput.click());

    // File input change handler
    fileInput.addEventListener('change', e => {
        Array.from(e.target.files)
            .filter(f => /\.pcf$/i.test(f.name))
            .forEach(f => handleFile(f));
    });
});
