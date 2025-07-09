export class PcfParser {
    constructor(text) {
        this.text = text || '';
        this.lines = this.text.split(/\r?\n/);
        this.materials = {};
    }

    parse() {
        console.groupCollapsed('🟡 PcfParser     → parse');
        console.log('Starting parse of PCF text, total lines:', this.lines.length);

        // 1. Abschnittsgrenzen finden
        const total = this.lines.length;
        let unitsEnd = total;
        let materialsStart = total;
        for (let i = 0; i < total; i++) {
            const t = this.lines[i].trim().toUpperCase();
            if (t === 'MATERIALS') {
                materialsStart = i;
                console.log('Found MATERIALS at line', i);
                break;
            }
        }
        for (let i = 0; i < materialsStart; i++) {
            const t = this.lines[i].trim().toUpperCase();
            if (t.startsWith('PIPELINE-REFERENCE')) {
                unitsEnd = i;
                console.log('Found first PIPELINE-REFERENCE at line', i);
                break;
            }
        }

        // 2. Sections slice
        const unitsLines = this.lines.slice(0, unitsEnd);
        const pipelinesLines = this.lines.slice(unitsEnd, materialsStart);
        const materialsLines = this.lines.slice(materialsStart);
        console.log(`Section lengths -> units: ${unitsLines.length}, pipelines: ${pipelinesLines.length}, materials: ${materialsLines.length}`);

        // 3. Delegation und Logging
        console.groupCollapsed('🟢 PcfParser._parseUnits');
        const units = this._parseUnits(unitsLines);
        console.log('Parsed units:', units);
        console.groupEnd();

        console.groupCollapsed('🟢 PcfParser._parseMaterials');
        const materials = this._parseMaterials(materialsLines);
        this.materials = materials;
        console.log('Parsed materials count:', Object.keys(materials).length);
        console.groupEnd();

        console.groupCollapsed('🟢 PcfParser._parsePipelines');
        const pipelines = this._parsePipelines(pipelinesLines);
        console.log('Parsed pipelines count:', pipelines.length);
        console.groupEnd();

        const parsed = { units, pipelines, materials };
        console.log('Parse result:', parsed);
        console.groupEnd();
        return parsed;
    }

    _parseUnits(lines) {
        console.log('Parsing UNITS section');
        const scaleMap = { MM: 0.001, CM: 0.01, M: 1, IN: 0.0254, INCH: 0.0254, FT: 0.3048, KGS: 1, LBS: 0.453592};
        let boreUnit = '', coordUnit = '', boltDiaUnit = '', boltLenUnit = '', weightUnit = '';
        lines.forEach(raw => {
            const trimmed = raw.trim();
            if (!trimmed) return;
            const upper = trimmed.toUpperCase();
            if (upper.startsWith('UNITS-BORE')) {
                boreUnit = trimmed.split(/\s+/)[1]?.toUpperCase() || '';
                console.log('Found UNITS-BORE:', boreUnit);
            }
            if (upper.startsWith('UNITS-CO-ORDS')) {
                coordUnit = trimmed.split(/\s+/)[1]?.toUpperCase() || '';
                console.log('Found UNITS-CO-ORDS:', coordUnit);
            }
            if (upper.startsWith('UNITS-BOLT-DIA')) {
                boltDiaUnit = trimmed.split(/\s+/)[1]?.toUpperCase() || '';
                console.log('Found UNITS-BOLT-DIA:', boltDiaUnit);
            }
            if (upper.startsWith('UNITS-BOLT-LENGTH')) {
                boltLenUnit = trimmed.split(/\s+/)[1]?.toUpperCase() || '';
                console.log('Found UNITS-BOLT-LENGTH:', boltLenUnit);
            }
            if (upper.startsWith('UNITS-WEIGHT')) {
                weightUnit = trimmed.split(/\s+/)[1]?.toUpperCase() || '';
                console.log('Found UNITS-WEIGHT:', weightUnit);
            }
        });
        const units = { boreUnit, coordUnit, boreScale: scaleMap[boreUnit] || 1, coordScale: scaleMap[coordUnit] || 1, boltDiaUnit, boltLenUnit, weightUnit, weightScale: scaleMap[weightUnit] || 1 };
        console.log('Units parsed with scales:', units);
        return units;
    }

    _parseMaterials(lines) {
        console.log('Parsing MATERIALS section');
        const materials = {};
        let currentKey = null;
        let currentRawLines = [];
        let inSection = false;

        for (const raw of lines) {
            const trimmed = raw.trim();
            if (!inSection) {
                if (trimmed === 'MATERIALS') inSection = true;
                continue;
            }
            if (!trimmed) continue;

            const parts = trimmed.split(/\s+/);
            if (parts[0] === 'ITEM-CODE') {
                if (currentKey !== null) {
                    materials[currentKey] = currentRawLines;
                }
                const code = parts[1];
                console.log('Found material key:', code);
                currentKey = code;
                currentRawLines = [raw];
            }
            else if (currentKey !== null) {
                currentRawLines.push(raw);
            }
        }
        if (currentKey !== null) {
            materials[currentKey] = currentRawLines;
        }
        return materials;
    }

    _parsePipelines(lines) {
        console.log('Parsing PIPELINE sections');
        const pipelines = [];
        const allRefs = new Set();
        const allTypes = new Set();

        let currentPipeline = null;
        let pipelineHeaderLines = [];
        let pipelineHeaderComplete = false;
        let currentComponent = null;

        const flushComponent = () => {
            if (!currentComponent) return;

            currentComponent.pipelineRawLines = [...pipelineHeaderLines];
            currentComponent.pipelineRef = currentPipeline.reference;

            const code = currentComponent.geometry['ITEM-CODE'];
            if (code) {
                const matLines = this.materials[code];
                currentComponent.materialRawLines = matLines || null;
                if (matLines) {
                    console.log('Matched material for code', code);
                } else {
                    console.warn('No material found for code', code);
                }
            } else {
                currentComponent.materialRawLines = null;
            }

            allTypes.add(currentComponent.type);
            allRefs.add(currentPipeline.reference);

            currentPipeline.components.push(currentComponent);
            console.log('Completed component:', currentComponent.type);
            currentComponent = null;
        };

        for (const raw of lines) {
            const line = raw.trim();
            if (line === 'MATERIALS') {
                console.log('Encountered MATERIALS boundary');
                break;
            }

            if (raw.startsWith('PIPELINE-REFERENCE')) {
                if (currentPipeline) {
                    flushComponent();
                    pipelines.push(currentPipeline);
                }
                const reference = line.slice('PIPELINE-REFERENCE'.length).trim();
                console.log('New pipeline reference:', reference);

                currentPipeline = { reference, attributes: {}, components: [] };
                pipelineHeaderLines = [raw];
                pipelineHeaderComplete = false;
                continue;
            }

            if (!currentPipeline) continue;

            if (!pipelineHeaderComplete) {
                if (/^[ \t]/.test(raw)) {
                    pipelineHeaderLines.push(raw);
                } else {
                    pipelineHeaderComplete = true;
                }
            }

            const isComponentHeader = /^[^ \t]/.test(raw) && pipelineHeaderComplete && !raw.startsWith('PIPELINE-REFERENCE');
            if (isComponentHeader) {
                flushComponent();
                const type = line.split(/\s+/)[0].toUpperCase();
                currentComponent = {
                    type,
                    geometry: {},
                    componentRawLines: [raw],
                    materialRawLines: null,
                    pipelineRawLines: null,
                    pipelineRef: null,
                    skey: null
                };
                console.log('New component header:', type);
            } else if (currentComponent) {
                const [key, ...vals] = line.split(/\s+/);
                if (key === 'ITEM-CODE') {
                    currentComponent.geometry['ITEM-CODE'] = vals[0];
                    console.log('Parsed component ITEM-CODE:', vals[0]);
                } else if (key === 'SKEY') {
                    currentComponent.skey = vals[0];
                    console.log('Parsed component SKEY:', vals[0]);
                } else if (key.endsWith('-POINT') || key === 'CO-ORDS' || key === 'CENTRE-POINT') {
                    const nums = vals.map(Number);
                    const coords = nums.slice(0, 3);
                    const nominal = nums.length >= 4 ? nums[3] : null;
                    currentComponent.geometry[key] = currentComponent.geometry[key] || [];
                    currentComponent.geometry[key].push({ coords, nominal });
                    console.log(`Parsed keypoint ${key}:`, { coords, nominal });
                }
                currentComponent.componentRawLines.push(raw);
            } else {
                const [attr, ...rest] = line.split(/\s+/);
                currentPipeline.attributes[attr] = rest.join(' ');
                console.log(`Parsed pipeline attribute ${attr}:`, rest.join(' '));
            }
        }

        if (currentPipeline) {
            flushComponent();
            pipelines.push(currentPipeline);
        }

        return {
            pipelines,
            meta: {
                pipelines: Array.from(allRefs),
                types: Array.from(allTypes)
            }
        };
    }
}
