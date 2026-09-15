import { addNode, editNode, deleteNode } from './diagram-edit';

const source = `flowchart TD
  A["开始 [[首页]]"]
  B["步骤一"]
  C["步骤二 [[详情]]"]
  A --> B
  B --> C`;

// 测试添加节点（带连接）
const { newSource: added, newId } = addNode(source, { label: '新节点', link: '新笔记', connectFrom: 'C' });
console.log('=== 添加节点 ===');
console.log(added);
console.log('新 ID:', newId);
console.assert(added.includes(`${newId}["新节点 [[新笔记]]"]`), '节点定义应存在');
console.assert(added.includes(`C --> ${newId}`), '连线应存在');

// 测试编辑节点
const edited = editNode(source, 'A', { label: '新开始', link: '新首页' });
console.log('\n=== 编辑节点 A ===');
console.log(edited);
console.assert(edited.includes('A["新开始 [[新首页]]"]'), '标签应更新');
console.assert(!edited.includes('A["开始 [[首页]]"]'), '旧标签应消失');

// 测试编辑节点移除链接
const editedNoLink = editNode(source, 'C', { label: '纯步骤二' });
console.log('\n=== 编辑节点 C（移除链接）===');
console.log(editedNoLink);
console.assert(editedNoLink.includes('C["纯步骤二"]'), '应无链接');

// 测试删除节点
const deleted = deleteNode(source, 'B');
console.log('\n=== 删除节点 B ===');
console.log(deleted);
console.assert(!deleted.includes('B["步骤一"]'), '节点 B 应被删除');
console.assert(!deleted.includes('A --> B'), '入边应被删除');
console.assert(!deleted.includes('B --> C'), '出边应被删除');
console.assert(deleted.includes('A'), '节点 A 应保留');
console.assert(deleted.includes('C'), '节点 C 应保留');

console.log('\n所有断言通过');
