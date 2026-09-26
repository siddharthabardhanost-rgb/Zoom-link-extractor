import React, { useState, useRef } from 'react';
import { Upload, FileText, Link as LinkIcon, Download, AlertCircle, CheckCircle2, Loader2, Copy, Check } from 'lucide-react';
import { Document, Packer, Paragraph, TextRun, ExternalHyperlink, HeadingLevel } from 'docx';

const BANNED_LINKS = [
  'https://forms.gle/gQ42fB3pRniV5GPv7',
  'https://link.be10x.in/24/7-LMS-Support-Bot-gif'
];

function isBannedUrl(url: string): boolean {
  const clean = url.trim().replace(/\/+$/, '');
  return BANNED_LINKS.some(banned => banned.trim().replace(/\/+$/, '') === clean);
}

interface ExtractedLink {
  name: string;
  url: string;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string>('');
  const [extractedLinks, setExtractedLinks] = useState<ExtractedLink[]>([]);
  const [hasExtracted, setHasExtracted] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    setFileError('');
    setHasExtracted(false);
    setExtractedLinks([]);

    if (selectedFile) {
      if (!selectedFile.name.toLowerCase().endsWith('.txt')) {
        setFileError('The uploaded file is not a TXT file.');
        setFile(null);
      } else {
        setFile(selectedFile);
      }
    }
  };

  const extractLinks = async () => {
    if (!file) return;

    setIsExtracting(true);
    setFileError('');

    try {
      const text = await file.text();
      
      const response = await fetch('/api/extract-links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || 'Failed to extract links. Please try again.');
      }

      const data = await response.json();
      const apiLinks: ExtractedLink[] = data.links || [];
      
      // Filter out banned links
      const filteredExtracted = apiLinks.filter(
        link => !isBannedUrl(link.url)
      );

      setExtractedLinks(filteredExtracted);
      setHasExtracted(true);
    } catch (err: any) {
      setFileError(err?.message || 'The file cannot be processed. Please try again.');
    } finally {
      setIsExtracting(false);
    }
  };

  const generateDocument = async () => {
    try {
      const doc = new Document({
        sections: [
          {
            properties: {},
            children: [
              new Paragraph({
                text: "Session Resources & Links",
                heading: HeadingLevel.HEADING_1,
                spacing: {
                  after: 200,
                },
              }),
              ...extractedLinks.map((link, index) => 
                new Paragraph({
                  spacing: {
                    before: 100,
                    after: 100,
                  },
                  children: [
                    new TextRun({
                      text: `${index + 1}. `,
                    }),
                    new ExternalHyperlink({
                      children: [
                        new TextRun({
                          text: link.name || link.url,
                          style: "Hyperlink",
                          color: "0000FF",
                          underline: {},
                        }),
                      ],
                      link: link.url,
                    }),
                  ],
                })
              ),
            ],
          },
        ],
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Session_Resources_Links.docx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error generating document:', error);
      alert('Failed to generate document. Please try again.');
    }
  };

  const handleCopyAll = async () => {
    if (extractedLinks.length === 0) return;
    const formatted = extractedLinks
      .map((link, index) => `${index + 1}. ${link.name}: ${link.url}`)
      .join('\n');

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(formatted);
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = formatted;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-neutral-50 py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-neutral-900 tracking-tight mb-3">
            Zoom Transcript Link Extractor
          </h1>
          <p className="text-neutral-600">
            Upload your Zoom .txt transcript to automatically extract all shared links.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden mb-8">
          <div className="p-8">
            <h2 className="text-lg font-semibold text-neutral-900 mb-4">1. Upload TXT File</h2>
            
            <div 
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                file ? 'border-blue-500 bg-blue-50' : 'border-neutral-300 hover:border-neutral-400 bg-neutral-50'
              }`}
            >
              <input 
                type="file" 
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".txt"
                className="hidden" 
              />
              
              {!file ? (
                <div className="flex flex-col items-center">
                  <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
                    <Upload className="w-6 h-6 text-neutral-500" />
                  </div>
                  <p className="text-neutral-700 font-medium mb-1">Click to upload or drag and drop</p>
                  <p className="text-sm text-neutral-500 mb-4">Only .txt files are supported</p>
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 bg-white border border-neutral-300 rounded-lg text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
                  >
                    Select File
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                    <FileText className="w-6 h-6 text-blue-600" />
                  </div>
                  <p className="text-neutral-900 font-medium mb-1">{file.name}</p>
                  <p className="text-sm text-neutral-500 mb-4">{(file.size / 1024).toFixed(1)} KB</p>
                  <button 
                    onClick={() => {
                      setFile(null);
                      setHasExtracted(false);
                      setExtractedLinks([]);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="text-sm text-red-600 hover:text-red-700 font-medium"
                  >
                    Remove file
                  </button>
                </div>
              )}
            </div>
            
            {fileError && (
              <div className="mt-4 flex items-center p-4 bg-red-50 text-red-700 rounded-lg">
                <AlertCircle className="w-5 h-5 mr-3 flex-shrink-0" />
                <p className="text-sm">{fileError}</p>
              </div>
            )}
          </div>

          <div className="border-t border-neutral-100 p-8 bg-neutral-50 flex justify-between items-center">
            <p className="text-sm text-neutral-600">
              Ready to process transcript
            </p>
            <button
              onClick={extractLinks}
              disabled={!file || isExtracting}
              className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center ${
                !file || isExtracting
                  ? 'bg-neutral-200 text-neutral-400 cursor-not-allowed' 
                  : 'bg-neutral-900 text-white hover:bg-neutral-800'
              }`}
            >
              {isExtracting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Extracting...
                </>
              ) : (
                'Extract Links'
              )}
            </button>
          </div>
        </div>

        {hasExtracted && (
          <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
            <div className="p-8">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-neutral-900 flex items-center">
                    <CheckCircle2 className="w-5 h-5 text-green-500 mr-2" />
                    Extraction Complete
                  </h2>
                  <p className="text-sm text-neutral-600 mt-1">
                    {extractedLinks.length} links found in transcript.
                  </p>
                </div>
                
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={handleCopyAll}
                    disabled={extractedLinks.length === 0}
                    className={`flex items-center justify-center px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                      copied
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                        : 'bg-white border-neutral-300 text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed'
                    }`}
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 mr-2 text-emerald-600" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-2 text-neutral-500" />
                        Copy All Links
                      </>
                    )}
                  </button>

                  <button
                    onClick={generateDocument}
                    disabled={extractedLinks.length === 0}
                    className="flex items-center justify-center px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Document
                  </button>
                </div>
              </div>
              
              {extractedLinks.length === 0 && (
                <div className="mb-6 p-4 bg-amber-50 text-amber-800 rounded-lg flex items-start">
                  <AlertCircle className="w-5 h-5 mr-3 flex-shrink-0 mt-0.5" />
                  <p className="text-sm">
                    No links were found in the uploaded transcript.
                  </p>
                </div>
              )}

              <div className="border border-neutral-200 rounded-xl overflow-hidden">
                <div className="bg-neutral-50 px-4 py-3 border-b border-neutral-200">
                  <h3 className="text-sm font-medium text-neutral-700">Preview</h3>
                </div>
                <ul className="divide-y divide-neutral-100 max-h-96 overflow-y-auto">
                  {extractedLinks.map((link, index) => (
                    <li key={index} className="px-4 py-3 flex items-start hover:bg-neutral-50 transition-colors">
                      <span className="text-sm font-medium text-neutral-400 w-6 flex-shrink-0 pt-0.5">
                        {index + 1}.
                      </span>
                      <div className="flex-1 min-w-0 flex items-start flex-col sm:flex-row sm:items-center">
                        <div className="flex items-center mb-1 sm:mb-0">
                          <LinkIcon className="w-4 h-4 text-neutral-400 mr-2 flex-shrink-0" />
                          <span className="text-sm font-semibold text-neutral-900 mr-3 truncate max-w-[200px] sm:max-w-xs">{link.name}</span>
                        </div>
                        <a 
                          href={link.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline truncate w-full sm:w-auto"
                          title={link.url}
                        >
                          {link.url}
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
