use wasm_bindgen::prelude::*;
#[wasm_bindgen]
extern "C" { #[wasm_bindgen(js_namespace=console,js_name=log)] fn log(s:&str); }
use burn::backend::wgpu::{WgpuDevice,WgpuRuntime,CubeBackend,init_setup_async,graphics::WebGpu};

use burn::tensor::{Tensor,TensorData,Bytes};
use cubecl::Runtime;
fn runtime_options()->burn::backend::wgpu::RuntimeOptions {
 let mut options=burn::backend::wgpu::RuntimeOptions::default();
 if cfg!(feature="exclusive-memory") { options.memory_config=burn::backend::wgpu::MemoryConfiguration::ExclusivePages; }
 options
}
thread_local!{static READY:std::cell::Cell<bool>=const{std::cell::Cell::new(false)};}
#[cfg(not(feature="fused-backend"))]
type B=Inner;
#[cfg(feature="fused-backend")]
type B=burn_fusion::Fusion<Inner>;
type Inner=CubeBackend<WgpuRuntime,f32,i32,u32>;
mod b1{include!(concat!(env!("OUT_DIR"),"/model/block-b1.rs"));}
mod b2{include!(concat!(env!("OUT_DIR"),"/model/block-b2.rs"));}
mod b4{include!(concat!(env!("OUT_DIR"),"/model/block-b4.rs"));}
enum Model{B1(b1::Model<B>),B2(b2::Model<B>),B4(b4::Model<B>)}
#[wasm_bindgen]
pub struct BlockRunner{device:WgpuDevice,model:Model,x:Vec<Tensor<B,4>>,w:Vec<Tensor<B,2>>,noise:Tensor<B,2>,last:Option<Tensor<B,4>>}
async fn sync(device:&WgpuDevice)->Result<(),JsValue>{
 #[cfg(feature="fused-backend")]
 burn_fusion::get_client::<Inner>(device).sync(|| ());

 WgpuRuntime::client(device).sync().await.map_err(|e|JsValue::from_str(&format!("{e:?}")))
}
#[wasm_bindgen]
impl BlockRunner{
 pub async fn create(weights:Vec<u8>,x:Vec<f32>,w:Vec<f32>,noise:Vec<f32>,batch:usize)->Result<BlockRunner,JsValue>{
  console_error_panic_hook::set_once();
  if ![1,2,4].contains(&batch)||x.len()!=4*256*128*128||w.len()!=4*512||noise.len()!=256*256{return Err(JsValue::from_str("Invalid fixture shapes"));}
  log("Burn: GPU setup");let device=WgpuDevice::default();if !READY.with(|v|v.get()){init_setup_async::<WebGpu>(&device,runtime_options()).await;READY.with(|v|v.set(true));}
  log("Burn: deserialize weights");let bytes=Bytes::from_bytes_vec(weights);
  let model=match batch{1=>Model::B1(b1::Model::from_bytes(bytes,&device)),2=>Model::B2(b2::Model::from_bytes(bytes,&device)),_=>Model::B4(b4::Model::from_bytes(bytes,&device))};
  log("Burn: upload inputs");let mut xs=Vec::new();let mut ws=Vec::new();
  for i in (0..4).step_by(batch){xs.push(Tensor::from_data(TensorData::new(x[i*256*128*128..(i+batch)*256*128*128].to_vec(),[batch,256,128,128]),&device));ws.push(Tensor::from_data(TensorData::new(w[i*512..(i+batch)*512].to_vec(),[batch,512]),&device));}
  let noise=Tensor::from_data(TensorData::new(noise,[256,256]),&device);log("Burn: initial sync");sync(&device).await?;log("Burn: ready");
  Ok(Self{device,model,x:xs,w:ws,noise,last:None})
 }
 pub async fn run(&mut self,calls:usize,depth:usize)->Result<(),JsValue>{
  if depth==0||depth>4{return Err(JsValue::from_str("Pipeline depth must be 1..4"));}
  let mut pending=Vec::new();
  for i in 0..calls{let k=i%self.x.len();let x=self.x[k].clone();let w=self.w[k].clone();let n=self.noise.clone();let y=match &self.model{Model::B1(m)=>m.forward(x,w,n),Model::B2(m)=>m.forward(x,w,n),Model::B4(m)=>m.forward(x,w,n)};pending.push(y);
   if pending.len()==depth||i+1==calls{sync(&self.device).await?;self.last=pending.pop();pending.clear();}
  }
  Ok(())
 }
 pub async fn debug(&self,stage:usize)->Result<Vec<f32>,JsValue>{
  let y=match &self.model{Model::B1(m)=>m.debug(self.x[0].clone(),self.w[0].clone(),self.noise.clone(),stage),_=>return Err(JsValue::from_str("Diagnostics require batch one"))};
  y.into_data_async().await.map_err(|e|JsValue::from_str(&format!("{e:?}")))?.to_vec::<f32>().map_err(|e|JsValue::from_str(&format!("{e:?}")))
 }
 pub async fn read(&self)->Result<Vec<f32>,JsValue>{
  let data=self.last.as_ref().ok_or_else(||JsValue::from_str("Run first"))?.clone().into_data_async().await;
  data.map_err(|e|JsValue::from_str(&format!("{e:?}")))?.to_vec::<f32>().map_err(|e|JsValue::from_str(&format!("{e:?}")))
 }
}
#[cfg(feature="full-model")]
mod full{include!(concat!(env!("OUT_DIR"),"/model/synthesis-polyphase.rs"));}
#[cfg(feature="full-model")]
#[wasm_bindgen]
pub struct FullRunner{device:WgpuDevice,model:full::Model<B>,w:Vec<Tensor<B,3>>,noise:Vec<Tensor<B,2>>,last:Option<Tensor<B,4>>}
#[cfg(feature="full-model")]
#[wasm_bindgen]
impl FullRunner{
 pub async fn create(weights:Vec<u8>,w:Vec<f32>,noise:Vec<f32>)->Result<FullRunner,JsValue>{
  console_error_panic_hook::set_once();let device=WgpuDevice::default();if !READY.with(|v|v.get()){init_setup_async::<WebGpu>(&device,runtime_options()).await;READY.with(|v|v.set(true));}
  log("Burn: full weights");let model=full::Model::from_bytes(Bytes::from_bytes_vec(weights),&device);
  let ws=w.chunks_exact(18*512).map(|v|Tensor::from_data(TensorData::new(v.to_vec(),[1,18,512]),&device)).collect();
  let mut ns=Vec::new();let mut offset=0;for size in [4,8,8,16,16,32,32,64,64,128,128,256,256,512,512,1024,1024]{let end=offset+size*size;ns.push(Tensor::from_data(TensorData::new(noise[offset..end].to_vec(),[size,size]),&device));offset=end;}
  sync(&device).await?;log("Burn: full ready");Ok(Self{device,model,w:ws,noise:ns,last:None})
 }
 pub async fn run(&mut self,calls:usize,depth:usize)->Result<(),JsValue>{
  if depth==0||depth>4||calls>self.w.len(){return Err(JsValue::from_str("Invalid run shape"));}let mut pending=Vec::new();let n=&self.noise;
  for i in 0..calls{pending.push(self.model.forward(self.w[i].clone(),n[0].clone(),n[1].clone(),n[2].clone(),n[3].clone(),n[4].clone(),n[5].clone(),n[6].clone(),n[7].clone(),n[8].clone(),n[9].clone(),n[10].clone(),n[11].clone(),n[12].clone(),n[13].clone(),n[14].clone(),n[15].clone(),n[16].clone()));if pending.len()==depth||i+1==calls{sync(&self.device).await?;self.last=pending.pop();pending.clear();}}
  Ok(())
 }
 pub async fn read(&self)->Result<Vec<f32>,JsValue>{self.last.as_ref().ok_or_else(||JsValue::from_str("Run first"))?.clone().into_data_async().await.map_err(|e|JsValue::from_str(&format!("{e:?}")))?.to_vec::<f32>().map_err(|e|JsValue::from_str(&format!("{e:?}")))}
}
// The exported resampling filters are identical for every channel (checked
// against ONNX initializers by validate_filter_rewrite.py). Treat channels as
// independent images to avoid the divergent grouped-convolution path.
fn checked_conv<T:burn::tensor::backend::Backend>(conv:&burn::nn::conv::Conv2d<T>,x:Tensor<T,4>)->Tensor<T,4>{
 if conv.groups==1{return conv.forward(x);}
 let [b,c,h,w]=x.dims();assert_eq!(conv.groups,c);assert_eq!(conv.weight.val().dims(),[c,1,4,4]);assert!(conv.bias.is_none());assert_eq!(conv.kernel_size,[4,4]);
 let (top,bottom,left,right)=match conv.padding{burn::nn::PaddingConfig2d::Valid=>(0,0,0,0),burn::nn::PaddingConfig2d::Explicit(t,l,b,r)=>(t,b,l,r),_=>panic!("Unsupported filter padding")};
 let weight=conv.weight.val().slice(burn::tensor::s![0..1,..,..,..]);
 let y=burn::tensor::module::conv2d(x.reshape([b*c,1,h,w]),weight,None,burn::tensor::ops::PaddedConvOptions::asymmetric(conv.stride,[top,left],[bottom,right],conv.dilation,1));let [_,_,oh,ow]=y.dims();y.reshape([b,c,oh,ow])
}
