import * as React from 'react';
import { init, exec } from 'pell';
import 'pell/dist/pell.css';
import { imageUploadError, imageUrl } from '../imageUrl';


export interface RichTextEditorProps {
  html: string;
  onChange?: (value: string) => void;
}

export class RichTextEditor extends React.Component<
  RichTextEditorProps
> {
  private container: HTMLDivElement;
  private editor: any;
  // Последнее место курсора в тексте: кнопка «вставить поле» забирает фокус
  private range?: Range;

  componentDidMount () {
    document.addEventListener('selectionchange', this.saveRange);
  }

  componentWillUnmount () {
    document.removeEventListener('selectionchange', this.saveRange);
  }

  componentDidUpdate (prevProps: RichTextEditorProps) {
    const content = this.container.querySelector('.pell-content')!;
    // Свой же ввод уже в тексте: перезапись сбросила бы курсор
    if (this.props.html !== prevProps.html && content.innerHTML !== this.props.html) {
      content.innerHTML = this.props.html;
    }
  }

  /**
   * Вставляет текст на место курсора, без курсора — в конец письма
   */
  insertText (text: string) {
    const content = this.editor.content as HTMLElement;
    content.focus();
    // В пустом тексте pell сам оборачивает первую строку в абзац, но не внутри
    // execCommand: абзац создаём сами
    if (!content.textContent && !content.querySelector('img')) {
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      content.replaceChildren(paragraph);
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      range.collapse(false);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      this.handleChange(content.innerHTML);
      return;
    }
    const selection = window.getSelection();
    if (selection) {
      let range = this.range;
      if (!range || !content.contains(range.startContainer)) {
        range = document.createRange();
        range.selectNodeContents(content);
        range.collapse(false);
      }
      selection.removeAllRanges();
      selection.addRange(range);
    }
    exec('insertText', text);
  }

  render () {
    return <div className='pell-container' ref={this.mountEditor}></div>;
  }

  private saveRange = () => {
    const selection = window.getSelection();
    if (this.editor && selection && selection.rangeCount &&
        this.editor.content.contains(selection.getRangeAt(0).startContainer)) {
      this.range = selection.getRangeAt(0).cloneRange();
    }
  };

  private handleChange = (html: string) => {
    if (this.props.onChange) {
      this.props.onChange(html);
    }
  };

  private insertImage = () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.addEventListener('change', async (event: any) => {
      const file = event.currentTarget.files && event.currentTarget.files[0];
      try {
        const fileLink = await this.uploadFile(file);
        exec('insertImage', fileLink);
        const image = this.container.querySelector(
          `.pell-content img[src="${fileLink}"]`
        ) as HTMLImageElement;
        if (image) {
          image.width = 500;
          this.handleChange(this.editor.content.innerHTML);
        }
      } catch (error) {
        alert(error instanceof ImageUploadError ? error.message : imageUploadError(0));
        console.error(error);
      }
    });
    fileInput.click();
  };

  private mountEditor = (ref: HTMLDivElement | null) => {
    if (ref) {
      this.container = ref;
      this.editor = init({
        actions: [
          'bold',
          'italic',
          'underline',
          'strikethrough',
          'heading1',
          'heading2',
          'paragraph',
          'olist',
          'ulist',
          'code',
          'line',
          {
            icon: '<small>Aa-</small>',
            name: 'font-small',
            result: () => exec('fontSize', 1),
            title: 'Мелкий шрифт'
          },
          {
            icon: 'Aa',
            name: 'font-normal',
            result: () => exec('fontSize', 3),
            title: 'Обычный шрифт'
          },
          {
            icon: '<big>Aa+</big>',
            name: 'font-large',
            result: () => exec('fontSize', 5),
            title: 'Крупный шрифт'
          },
          {
            icon: '&lt;a href=...&gt;',
            name: 'link',
            title: 'Ссылка'
          },
          {
            icon: '&lt;img&gt;',
            name: 'image',
            result: this.insertImage,
            title: 'Вставить изображение'
          }
        ],
        element: ref,
        onChange: this.handleChange
      });
      this.editor.content.innerHTML = this.props.html;
    }
  };

  private async uploadFile (file: File) {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch(IMAGE_SERVICE_URL + '/ul', {
      body: form,
      method: 'POST'
    });
    if (!response.ok) {
      throw new ImageUploadError(imageUploadError(response.status));
    }
    const jsonResponse = await response.json();
    return imageUrl(IMAGE_PUBLIC_URL, IMAGE_SERVICE_URL, jsonResponse.id, file.name);
  }
}

class ImageUploadError extends Error {}
