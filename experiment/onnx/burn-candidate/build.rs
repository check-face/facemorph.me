use burn_onnx::{ModelGen,LoadStrategy};
fn main(){
 let root=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../review-artifacts");
 let mut g=ModelGen::new();g.out_dir("model/").load_strategy(LoadStrategy::Bytes).development(false);
 for b in [1,2,4]{let p=root.join(format!("browser-onnx-block/block-b{b}.onnx"));println!("cargo:rerun-if-changed={}",p.display());g.input(p.to_str().unwrap());}
 println!("cargo:rerun-if-env-changed=BURN_FULL_IMPORT");
 if std::env::var_os("CARGO_FEATURE_FULL_MODEL").is_some(){let p=root.join("browser-onnx-profile/synthesis-polyphase.onnx");g.input(p.to_str().unwrap());}
 g.run_from_script();
 // Burn 0.21's Col layout load mapper calls blocking Backend::sync,
 // which panics on browser WASM. Adapt packs with fix_burnpack.py.
 for b in [1,2,4] {
  let p=std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join(format!("model/block-b{b}.rs"));
  let code=std::fs::read_to_string(&p).unwrap();
  assert!(code.contains("LinearLayout::Col"));
  let mut code=code.replace("LinearLayout::Col","LinearLayout::Row");
  if b==1 {
   let at=code.find("    #[allow(clippy::let_and_return").unwrap();
   let forward=&code[at..code.len()-2];
   let mut debug=forward.replace("pub fn forward(","pub fn debug(").replace("noise: Tensor<B, 2>,","noise: Tensor<B, 2>, stage:usize,").replace(") -> Tensor<B, 4>",") -> Tensor<B, 1>");
   for (i,name) in ["linear1_out1","mul3_out1","convtranspose2d1_out1","conv2d1_out1","mul4_out1","mul6_out1","pad2_out1","slice2_out1","reshape5_out1"].iter().enumerate(){
    let start=debug.find(&format!("let {name} =")).unwrap();let end=start+debug[start..].find(';').unwrap()+1;
    debug.insert_str(end,&format!(" if stage=={i} {{return {name}.reshape([-1]);}}"));
   }
   debug=debug.replace("        mul6_out1\n","        mul6_out1.reshape([-1])\n");
   let end=code.len()-2;code.insert_str(end,&debug);
  }
  std::fs::write(p,code).unwrap();
 }
 if std::env::var_os("CARGO_FEATURE_FULL_MODEL").is_some(){let p=std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("model/synthesis-polyphase.rs");let code=std::fs::read_to_string(&p).unwrap();std::fs::write(p,code.replace("LinearLayout::Col","LinearLayout::Row")).unwrap();}
 let status=std::process::Command::new("python3").arg("patch_filters.py").arg(std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("model")).status().unwrap();assert!(status.success());
 println!("cargo:rerun-if-changed=patch_filters.py");
}
