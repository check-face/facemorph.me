from pathlib import Path
import subprocess, os, hashlib, json
C=Path(__file__).resolve().parent
SDK=C/'work/emsdk/upstream/emscripten'
P=C/'vendor/pillow-12.3.0/src/libImaging'
D=C/'vendor/dlib-20.0.1'
J=C/'vendor/libjpeg-turbo-3.1.4.1';JB=C/'work/jpeg-build'
OUT=C/'dist'; OUT.mkdir(exist_ok=True)
O=C/'work/obj';O.mkdir(exist_ok=True)
H=C/'work/pillow-cxx-header';H.mkdir(exist_ok=True)
# Pillow's C-only struct tag and pointer typedef use the same identifier, which
# is illegal in C++. Rename only the unused arena struct tag in this header view.
(H/'Imaging.h').write_text((P/'Imaging.h').read_text().replace('struct ImagingMemoryArena','struct ImagingMemoryArenaStorage'))
env=dict(os.environ,EMCC_CORES='2')
subprocess.run([str(SDK/'emcmake'),'cmake','-S',str(J),'-B',str(JB),'-DCMAKE_BUILD_TYPE=Release','-DENABLE_SHARED=OFF','-DENABLE_STATIC=ON','-DWITH_SIMD=OFF','-DWITH_TURBOJPEG=OFF','-DWITH_TOOLS=OFF','-DWITH_TESTS=OFF'],check=True,env=env)
subprocess.run(['cmake','--build',str(JB),'--target','jpeg-static','-j','2'],check=True,env=env)
flags=['-O2','-fexceptions','-ffp-contract=off','-ffunction-sections','-fdata-sections','-I'+str(C/'native'),'-I'+str(H),'-I'+str(P)]
objects=[]
for path in [C/'native/pillow_support.c',P/'Geometry.c',P/'Resample.c']:
 target=O/(path.stem+'.o');subprocess.run([str(SDK/'emcc'),*flags,'-c',str(path),'-o',str(target)],check=True,env=env);objects.append(str(target))
cxx=[str(SDK/'em++'),*flags,'-std=c++17','-DDLIB_NO_GUI_SUPPORT','-DDLIB_PNG_SUPPORT','-DDLIB_JPEG_SUPPORT','-I'+str(D),'-I'+str(J/'src'),'-I'+str(JB),'-sUSE_LIBPNG=1']
for path in [C/'native/photo.cpp',D/'dlib/all/source.cpp']:
 target=O/(path.stem+'.o');subprocess.run([*cxx,'-c',str(path),'-o',str(target)],check=True,env=env);objects.append(str(target))
command=[*cxx,*objects,str(JB/'libjpeg.a'),'-sMODULARIZE=1','-sEXPORT_ES6=1','-sEXPORT_NAME=createPhotoModule','-sENVIRONMENT=web,worker,node','-sFILESYSTEM=0','-sALLOW_MEMORY_GROWTH=1','-sINITIAL_MEMORY=33554432','-sMAXIMUM_MEMORY=268435456','-sSTACK_SIZE=2097152','-sABORTING_MALLOC=0','-sMALLOC=emmalloc','-sDISABLE_EXCEPTION_CATCHING=0','-sEXPORTED_FUNCTIONS=["_malloc","_free"]','-sEXPORTED_RUNTIME_METHODS=["UTF8ToString","HEAPU8"]','-o',str(OUT/'photo-native.mjs')]
subprocess.run(command,check=True,env=env)
files={str(p.relative_to(C)):{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}for p in list((C/'native').glob('*'))+[OUT/'photo-native.mjs',OUT/'photo-native.wasm']}
(OUT/'build-receipt.json').write_text(json.dumps({'compiler':'Emscripten4.0.23','dlib':'20.0.1','pillow':'12.3.0','jpeg':'libjpeg-turbo3.1.4.1','maxWasmBytes':268435456,'unshared':True,'files':files,'numericalQualification':'pending'},indent=2)+'\n')
print(json.dumps(files,indent=2))
