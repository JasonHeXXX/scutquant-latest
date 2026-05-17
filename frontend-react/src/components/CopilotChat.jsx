import React, { useState, useRef, useEffect } from 'react';
import { FloatButton, Drawer, Input, Button, List, Spin, message, Card, Typography } from 'antd';
import { RobotOutlined, SendOutlined, CopyOutlined, UserOutlined } from '@ant-design/icons';
import axios from 'axios';

const { TextArea } = Input;
const { Text } = Typography;

const CopilotChat = () => {
  const [open, setOpen] = useState(false); // 控制侧边栏开关
  const [input, setInput] = useState('');    // 用户输入框
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'system', content: '你好！我是 SCUTQUANT Copilot。你可以让我帮你写因子，比如：“写一个动量因子，计算过去20天的收益率”。' }
  ]);

  // 滚动到底部的引用
  const messagesEndRef = useRef(null);
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(scrollToBottom, [messages]);

  // 发送消息
  const handleSend = async () => {
    if (!input.trim()) return;

    // 1. 立即显示用户消息
    const userMsg = { role: 'user', content: input };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput('');
    setLoading(true);

    try {
      // 2. 调用后端 API
      // 注意：这里要把 system 消息过滤掉，或者后端copilot.py如果只处理user消息的话要适配
      // 我们之前的后端代码是把 history 拼接到 system prompt 后面，所以直接传 newHistory 即可
      // 但是为了节省 token，通常只传最近几轮，这里先传全部非 system 消息
      const apiMessages = newHistory.filter(m => m.role !== 'system');

      const res = await axios.post('http://127.0.0.1:8000/api/v1/copilot/chat', {
        messages: apiMessages,
        temperature: 0.1
      });

      // 3. 显示 AI 回复
      const aiMsg = { role: 'assistant', content: res.data.reply };
      setMessages([...newHistory, aiMsg]);
      
    } catch (error) {
      console.error(error);
      message.error("AI 思考时断线了，请检查后端是否启动");
    } finally {
      setLoading(false);
    }
  };

  // 复制内容到剪贴板
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    message.success('已复制到剪贴板');
  };

  // 渲染单条消息
  const renderItem = (item) => {
    const isUser = item.role === 'user';
    const isSystem = item.role === 'system';
    
    // 简单的 Markdown 代码块检测（```python ... ```）
    // 如果内容包含代码块，我们把它提取出来特殊显示
    let content = item.content;
    let codeBlock = null;
    
    if (content.includes('```')) {
      const parts = content.split('```');
      content = parts[0]; // 简化的处理，只取代码前的文字
      // parts[1] 通常是 python\n代码...
      codeBlock = parts[1].replace(/^python\n/, '').replace(/^python/, ''); 
    }

    return (
      <List.Item style={{ padding: '10px 0', display: 'block' }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: isUser ? 'flex-end' : 'flex-start',
          marginBottom: '5px'
        }}>
          {!isUser && !isSystem && <RobotOutlined style={{ marginRight: 8, marginTop: 4, color: '#1890ff' }} />}
          
          <div style={{ maxWidth: '85%' }}>
            {/* 气泡框 */}
            <Card 
              size="small" 
              bodyStyle={{ padding: '8px 12px' }}
              style={{ 
                backgroundColor: isUser ? '#1890ff' : '#333', 
                color: isUser ? '#fff' : '#eee',
                borderColor: isUser ? '#1890ff' : '#444',
                borderRadius: '8px'
              }}
            >
              <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>
              
              {/* 如果有代码块，显示复制代码按钮 */}
              {codeBlock && (
                <div style={{ marginTop: '10px', background: '#000', padding: '8px', borderRadius: '4px', position: 'relative' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: '12px', color: '#a6e22e' }}>
                    {codeBlock}
                  </div>
                  <Button 
                    type="text" 
                    icon={<CopyOutlined />} 
                    size="small"
                    style={{ position: 'absolute', top: 0, right: 0, color: '#fff' }}
                    onClick={() => copyToClipboard(codeBlock.trim())}
                  >
                    复制
                  </Button>
                </div>
              )}
            </Card>
          </div>

          {isUser && <UserOutlined style={{ marginLeft: 8, marginTop: 4, color: '#aaa' }} />}
        </div>
      </List.Item>
    );
  };

  return (
    <>
      {/* 1. 悬浮按钮：点击打开聊天窗 */}
      <FloatButton 
        icon={<RobotOutlined />} 
        type="primary" 
        style={{ right: 24, bottom: 80, width: 50, height: 50 }} 
        onClick={() => setOpen(true)}
        tooltip="打开 AI 助手"
      />

      {/* 2. 侧边抽屉：聊天主界面 */}
      <Drawer
        title="SCUTQUANT Copilot"
        placement="right"
        onClose={() => setOpen(false)}
        open={open}
        width={400}
        mask={false} // 不遮挡主界面，可以边看边写
        bodyStyle={{ padding: '0 10px', display: 'flex', flexDirection: 'column' }}
      >
        {/* 消息列表区域 */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: '20px' }}>
          <List
            itemLayout="horizontal"
            dataSource={messages}
            renderItem={renderItem}
            split={false}
          />
          {loading && (
            <div style={{ textAlign: 'center', padding: '20px', color: '#aaa' }}>
              <Spin size="small" /> 正在思考因子逻辑...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入区域 */}
        <div style={{ borderTop: '1px solid #444', padding: '15px 0' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <TextArea 
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="描述你想写的因子..."
              autoSize={{ minRows: 2, maxRows: 4 }}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <Button 
              type="primary" 
              icon={<SendOutlined />} 
              onClick={handleSend}
              loading={loading}
              style={{ height: 'auto' }}
            />
          </div>
          <Text type="secondary" style={{ fontSize: '10px', marginTop: '5px', display: 'block' }}>
            提示：生成的因子表达式可以直接复制到左侧回测框中。
          </Text>
        </div>
      </Drawer>
    </>
  );
};

export default CopilotChat;