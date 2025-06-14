import { Fragment, useEffect, useMemo, useRef } from 'react';
import { FormProvider, useForm, useFormContext } from 'react-hook-form';
import { proxy, useSnapshot } from 'valtio';
import clsx from 'clsx';
import startCase from 'lodash.startcase';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Edges } from '@react-three/drei';
import potpack from 'potpack';
import { STLExporter } from 'three/examples/jsm/Addons.js';
import { downloadZip } from 'client-zip';

import Box1Src from './assets/box_1.png';
import Box2Src from './assets/box_2.png';

const exporter = new STLExporter();
const serializer = new XMLSerializer();
const xmlns = 'http://www.w3.org/2000/svg';

const defaultValues = {
  sideA: '100',
  sideATabCount: '3',
  sideB: '200',
  sideBTabCount: '3',
  sideC: '50',
  sideCTabCount: '2',
  materialThickness: '3.175',
  units: 'mm',
  stlScale: '0.001',
  svgLayoutMargin: '5',
};

const state = proxy({
  back: null,
  side: null,
  top: null,
  sideA: 100,
  sideATabCount: 3,
  sideB: 200,
  sideBTabCount: 3,
  sideC: 50,
  sideCTabCount: 2,
  materialThickness: 3.175,
  units: 'mm',
  stlScale: 0.001,
  svgLayoutMargin: 5,
  showDownloadDialog: false,
});

function moveTo(x, y) {
  return `M${x},${y}`;
}

function lineTo(x, y) {
  return `L${x},${y}`;
}

function getPanelData(w, wtc, wi, h, htc, hi, t) {
  const rwtw = w / (wtc * 2 - 1);
  const rhtw = h / (htc * 2 - 1);

  const top = [];
  const right = [];

  // Top
  if (wi) {
    let x = rwtw;
    for (let i = 0; i < wtc - 1; i++) {
      top.push(
        [x + i * rwtw, t],
        [x + i * rwtw, 0],
        [x + i * rwtw + rwtw, 0],
        [x + i * rwtw + rwtw, t]
      );
      x += rwtw;
    }
  } else {
    let x = 0;
    for (let i = 0; i < wtc; i++) {
      if (i > 0) {
        top.push([x + i * rwtw, t]);
      }

      top.push([x + i * rwtw, 0], [x + i * rwtw + rwtw, 0]);

      if (i < wtc - 1) {
        top.push([x + i * rwtw + rwtw, t]);
      }

      x += rwtw;
    }

    top.shift();
    top.pop();
  }

  // Right
  if (hi) {
    let y = rhtw;
    for (let i = 0; i < htc - 1; i++) {
      right.push(
        [w - t, y + i * rhtw],
        [w, y + i * rhtw],
        [w, y + i * rhtw + rhtw],
        [w - t, y + i * rhtw + rhtw]
      );
      y += rhtw;
    }
  } else {
    let y = 0;
    for (let i = 0; i < htc; i++) {
      if (i > 0) {
        right.push([w - t, y + i * rhtw]);
      }

      right.push([w, y + i * rhtw], [w, y + i * rhtw + rhtw]);

      if (i < htc - 1) {
        right.push([w - t, y + i * rhtw + rhtw]);
      }

      y += rhtw;
    }

    right.shift();
    right.pop();
  }

  // Bottom and left are just inversions of the top and right sides
  const bottom = top.map(([x, y]) => [x * -1 + w, y * -1 + h]);
  const left = right.map(([x, y]) => [x * -1 + w, y * -1 + h]);

  // Determine the corner limits
  let x1 = 0;
  let y1 = 0;

  if (hi) {
    x1 = t;
  }

  if (wi) {
    y1 = t;
  }

  let x2 = w - x1;
  let y2 = h - y1;

  return [
    [x1, y1],
    ...top,
    [x2, y1],
    ...right,
    [x2, y2],
    ...bottom,
    [x1, y2],
    ...left,
  ];
}

function createExtrusionShape(points) {
  const shape = new THREE.Shape();
  const first = points[0];
  shape.moveTo(first[0], first[1]);
  points.slice(1).forEach(([x, y]) => {
    shape.lineTo(x, y);
  });
  return shape;
}

function downloadSVGLayoutFile() {
  const m = state.svgLayoutMargin;
  const sideA = state.sideA + m * 2;
  const sideB = state.sideB + m * 2;
  const sideC = state.sideC + m * 2;
  const boxes = [
    { w: sideA, h: sideB, points: state.back },
    { w: sideA, h: sideB, points: state.back },
    { w: sideC, h: sideB, points: state.side },
    { w: sideC, h: sideB, points: state.side },
    { w: sideC, h: sideA, points: state.top },
    { w: sideC, h: sideA, points: state.top },
  ];

  const { w, h } = potpack(boxes);
  const svg = createSVG(w, h);

  boxes.forEach((box) => {
    const path = document.createElementNS(xmlns, 'path');
    path.setAttributeNS(null, 'd', pointsToD(box.points, box.x + m, box.y + m));

    svg.appendChild(path);
  });

  const blob = new Blob([serializer.serializeToString(svg)], {
    type: 'image/svg+xml',
  });

  downloadBlob(blob, 'box_layout.svg');
}

function createSVG(width, height) {
  const units = state.units;
  const svg = document.createElementNS(xmlns, 'svg');
  svg.setAttributeNS(null, 'viewBox', `0 0 ${width} ${height}`);
  svg.setAttributeNS(null, 'width', `${width}${units}`);
  svg.setAttributeNS(null, 'height', `${height}${units}`);
  svg.setAttributeNS(null, 'stroke', '#000');
  svg.setAttributeNS(null, 'fill', 'none');

  return svg;
}

function pointsToD(points, transX = 0, transY = 0) {
  return points
    .map(([x, y], index) => {
      if (index === 0) {
        return moveTo(x + transX, y + transY);
      }
      return lineTo(x + transX, y + transY);
    })
    .concat('Z')
    .join(' ');
}

function getSVGFile(width, height, points, name) {
  const svg = createSVG(width, height);
  const path = document.createElementNS(xmlns, 'path');
  path.setAttributeNS(null, 'd', pointsToD(points));

  svg.appendChild(path);

  return {
    type: 'image/svg+xml',
    input: serializer.serializeToString(svg),
    name,
  };
}

function getSTLFile({ points }, name) {
  const shape = createExtrusionShape(points);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: false,
    depth: state.materialThickness,
  });
  const scale = state.stlScale;
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(),
    new THREE.Quaternion(),
    new THREE.Vector3(scale, scale, scale)
  );

  geometry.applyMatrix4(matrix);

  const mesh = new THREE.Mesh(geometry);
  const stl = exporter.parse(mesh, { binary: true });

  return { type: 'application/octet-stream', input: stl, name };
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const element = document.createElement('a');
  element.href = url;
  element.download = name;
  element.click();
  URL.revokeObjectURL(url);
}

async function zipFiles(files, name) {
  const zip = downloadZip(files);
  const blob = await zip.blob();

  downloadBlob(blob, name);
}

const Extrusion = ({ data, ...props }) => {
  const snap = useSnapshot(state);
  const shape = useMemo(() => createExtrusionShape(data), [data]);

  return (
    <mesh {...props}>
      <extrudeGeometry
        args={[shape, { bevelEnabled: false, depth: snap.materialThickness }]}
      />
      <meshPhongMaterial />
      <Edges lineWidth={4} color="#18171c" />
    </mesh>
  );
};

const InputField = ({ formKey, label, valueAsNumber = true }) => {
  const {
    register,
    formState: { errors },
  } = useFormContext();
  const error = errors[formKey];

  return (
    <div className="flex flex-col">
      <label className="font-bold">{label ? label : startCase(formKey)}</label>
      <input
        type="text"
        className={clsx('border rounded px-2 py-1', {
          'border-red-500': !!error,
        })}
        required
        {...register(formKey, { valueAsNumber })}
      />
      {error && <div className="text-red-500">{error.message}</div>}
    </div>
  );
};

export const App = () => {
  const methods = useForm({
    defaultValues,
  });
  const formRef = useRef();
  const snap = useSnapshot(state);
  const { handleSubmit, setError } = methods;

  const onValid = ({
    sideA,
    sideATabCount,
    sideB,
    sideBTabCount,
    sideC,
    sideCTabCount,
    materialThickness,
    units,
    stlScale,
    svgLayoutMargin,
  }) => {
    if (isNaN(sideA)) {
      setError('sideA', {
        type: 'custom',
        message: 'Invalid value',
      });
      return;
    }
    if (isNaN(sideB)) {
      setError('sideB', {
        type: 'custom',
        message: 'Invalid value',
      });
      return;
    }
    if (isNaN(sideC)) {
      setError('sideC', {
        type: 'custom',
        message: 'Invalid value',
      });
      return;
    }
    if (isNaN(sideATabCount) || sideATabCount < 2) {
      setError('sideATabCount', {
        type: 'custom',
        message: 'Value must be greater than 1',
      });
      return;
    }
    if (isNaN(sideBTabCount) || sideBTabCount < 2) {
      setError('sideBTabCount', {
        type: 'custom',
        message: 'Value must be greater than 1',
      });
      return;
    }
    if (isNaN(sideCTabCount) || sideCTabCount < 2) {
      setError('sideCTabCount', {
        type: 'custom',
        message: 'Value must be greater than 1',
      });
      return;
    }
    if (isNaN(materialThickness)) {
      setError('materialThickness', {
        type: 'custom',
        message: 'Invalid value',
      });
      return;
    }

    state.back = null;
    state.top = null;
    state.side = null;

    // Hack to unmount the meshes to get the edges to re-render properly
    setTimeout(() => {
      // Back
      state.back = getPanelData(
        sideA,
        sideATabCount,
        true,
        sideB,
        sideBTabCount,
        true,
        materialThickness
      );
      // Side
      state.side = getPanelData(
        sideC,
        sideCTabCount,
        false,
        sideB,
        sideBTabCount,
        false,
        materialThickness
      );
      // Top
      state.top = getPanelData(
        sideC,
        sideCTabCount,
        true,
        sideA,
        sideATabCount,
        false,
        materialThickness
      );
    }, 10);

    // Copy form values into valtio state
    state.sideA = sideA;
    state.sideATabCount = sideATabCount;
    state.sideB = sideB;
    state.sideBTabCount = sideBTabCount;
    state.sideC = sideC;
    state.sideCTabCount = sideCTabCount;
    state.materialThickness = materialThickness;
    state.units = units;
    state.stlScale = stlScale;
    state.svgLayoutMargin = svgLayoutMargin;
  };

  useEffect(() => {
    formRef.current.requestSubmit();
  }, []);

  const handleDownloadSTLClick = () => {
    zipFiles(
      [
        getSTLFile(state.back, 'back.stl'),
        getSTLFile(state.side, 'side.stl'),
        getSTLFile(state.top, 'top.stl'),
      ],
      'box_stl.zip'
    );
  };

  const handleDownloadSVGClick = () => {
    zipFiles(
      [
        getSVGFile(state.sideA, state.sideB, state.back, 'back.svg'),
        getSVGFile(state.sideC, state.sideB, state.side, 'side.svg'),
        getSVGFile(state.sideC, state.sideA, state.top, 'top.svg'),
      ],
      'box_svg.zip'
    );
  };

  const handleDownloadSVGLayoutClick = () => {
    downloadSVGLayoutFile();
  };

  return (
    <div>
      <FormProvider {...methods}>
        <div className="flex gap-8">
          <div className="w-[250px]"></div>
          <div className="text-4xl mb-12 text-center flex-1">
            Laser Box Maker
          </div>
        </div>
        <div className="flex gap-8">
          <form
            className="flex flex-col gap-12 w-[250px]"
            onSubmit={handleSubmit(onValid)}
            ref={formRef}
          >
            <div className="flex flex-col gap-4">
              <InputField formKey="sideA" />
              <InputField formKey="sideATabCount" />
              <InputField formKey="sideB" />
              <InputField formKey="sideBTabCount" />
              <InputField formKey="sideC" />
              <InputField formKey="sideCTabCount" />
              <InputField formKey="materialThickness" />
              <InputField formKey="units" valueAsNumber={false} />
              <InputField formKey="stlScale" label="STL Scale" />
              <InputField formKey="svgLayoutMargin" label="SVG Layout Margin" />
            </div>
            <div className="flex flex-col gap-4">
              <button
                className="bg-sky-500 rounded cursor-pointer py-1 hover:bg-sky-600 transition-colors w-full"
                type="submit"
              >
                Generate
              </button>
              <button
                className="border border-sky-500 text-sky-500 rounded cursor-pointer py-1 hover:border-sky-600 hover:text-sky-600 transition-colors w-full"
                type="button"
                onClick={handleDownloadSTLClick}
              >
                Download STL ZIP
              </button>
              <button
                className="border border-sky-500 text-sky-500 rounded cursor-pointer py-1 hover:border-sky-600 hover:text-sky-600 transition-colors w-full"
                type="button"
                onClick={handleDownloadSVGClick}
              >
                Download SVG ZIP
              </button>
              <button
                className="border border-sky-500 text-sky-500 rounded cursor-pointer py-1 hover:border-sky-600 hover:text-sky-600 transition-colors w-full"
                type="button"
                onClick={handleDownloadSVGLayoutClick}
              >
                Download SVG Layout
              </button>
            </div>
          </form>
          <div className="flex-1 flex flex-col gap-8 min-w-0">
            <div className="flex justify-center">
              <img
                src={Box1Src}
                className="object-contain max-w-[600px] w-full"
              />
              <img
                src={Box2Src}
                className="object-contain max-w-[600px] w-full"
              />
            </div>
            <div className="min-h-[600px]">
              <Canvas
                camera={{
                  position: [-65, 213, 61],
                }}
              >
                <color attach="background" args={['#ecebee']} />
                {snap.back && (
                  <Fragment>
                    <Extrusion data={snap.back} />
                    <Extrusion
                      data={snap.back}
                      position={[0, 0, -snap.sideC + snap.materialThickness]}
                    />
                  </Fragment>
                )}
                {snap.side && (
                  <Fragment>
                    <Extrusion
                      data={snap.side}
                      rotation={[0, Math.PI / 2, 0]}
                      position={[0, 0, snap.materialThickness]}
                    />
                    <Extrusion
                      data={snap.side}
                      rotation={[0, Math.PI / 2, 0]}
                      position={[
                        snap.sideA - snap.materialThickness,
                        0,
                        snap.materialThickness,
                      ]}
                    />
                  </Fragment>
                )}
                {snap.top && (
                  <Fragment>
                    <Extrusion
                      data={snap.top}
                      rotation={[-Math.PI / 2, 0, -Math.PI / 2]}
                      position={[0, 0, -snap.sideC + snap.materialThickness]}
                    />
                    <Extrusion
                      data={snap.top}
                      rotation={[-Math.PI / 2, 0, -Math.PI / 2]}
                      position={[
                        0,
                        snap.sideB - snap.materialThickness,
                        -snap.sideC + snap.materialThickness,
                      ]}
                    />
                  </Fragment>
                )}
                <ambientLight intensity={1} />
                <OrbitControls
                  target={[
                    snap.sideA * 0.5,
                    snap.sideB * 0.5,
                    -snap.sideC * 0.5,
                  ]}
                />
              </Canvas>
            </div>
          </div>
        </div>
      </FormProvider>
    </div>
  );
};
